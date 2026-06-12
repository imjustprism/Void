/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModelId, ReasoningMode } from "@grok-types/enums/models";
import type { GrokResponse } from "@grok-types/stores";
import { ChatPageStore, ModesStore, ResponseStore, RoutingStore } from "@turbopack/common/stores";
import { ApiClients } from "@turbopack/common/utils";
import { getEditor, type TiptapEditor } from "@utils/editor";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";

import { GROK } from "./constants";
import type { GrokArgs } from "./types";
import { type ActionMap, dispatch, errorMessage, serialize } from "./utils";

const logger = new Logger("Grok");

const chatState = () => ChatPageStore.useChatPageStore.getState();
const responsesFor = (conversationId: string): GrokResponse[] | undefined =>
    ResponseStore.useResponseStore.getState().byConversationId[conversationId];
const currentConversationId = (): string | undefined => RoutingStore.useRoutingStore.getState().route?.conversationId ?? undefined;

const isAssistant = (r: GrokResponse): boolean => r.sender?.toLowerCase() === "assistant";
const isReal = (r: GrokResponse): boolean => !!r.responseId && !r.responseId.startsWith("optimistic_");
const isFinal = (r: GrokResponse): boolean => r.state !== "streaming" && !r.partial;

function latestAssistant(responses: GrokResponse[], afterIndex: number): GrokResponse | null {
    for (let i = responses.length - 1; i > afterIndex; i--) {
        const r = responses[i];
        if (isAssistant(r) && isReal(r)) return r;
    }
    return null;
}

function blockReason(state = chatState()): string | null {
    if (state.isRateLimited) return typeof state.isRateLimited === "string" ? state.isRateLimited : "Rate limited";
    if (state.isUnauthenticated) return "Authentication required";
    return null;
}

const dispatchClick = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

function clickInternalLink(path: string): boolean {
    const link = document.querySelector<HTMLElement>(`a[href="${CSS.escape(path)}"]`);
    if (link) return dispatchClick(link), true;

    const fallback = document.querySelector('a[href*="/c/"]') ?? document.querySelector('a[href="/"]');
    if (!fallback) return false;

    const orig = fallback.getAttribute("href") ?? "/";
    fallback.setAttribute("href", path);
    dispatchClick(fallback);
    fallback.setAttribute("href", orig);
    return true;
}

async function navigateToChat(conversationId?: string): Promise<void> {
    const current = currentConversationId();
    if (conversationId ? current === conversationId : !current) return;

    const target = conversationId ? `/c/${conversationId}` : "/";
    if (!clickInternalLink(target)) throw new Error("Navigation failed: could not find internal link.");
    await sleep(GROK.NAV_DELAY);
}

function waitForEditor(timeoutMs = GROK.EDITOR_TIMEOUT): Promise<TiptapEditor> {
    const ready = getEditor();
    if (ready) return Promise.resolve(ready);

    return new Promise((resolve, reject) => {
        const start = Date.now();
        const poll = setInterval(() => {
            const editor = getEditor();
            if (editor) {
                clearInterval(poll);
                resolve(editor);
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(poll);
                reject(new Error("Editor not ready"));
            }
        }, GROK.EDITOR_POLL_INTERVAL);
    });
}

function submitEditor(): void {
    const pm = document.querySelector(".ProseMirror");
    if (!pm) throw new Error("ProseMirror element not found");
    pm.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
}

interface SentResponse {
    conversationId: string;
    responseId: string;
    message: string;
    thinkingTrace?: string;
}

function formatResponse(r: GrokResponse, maxLength = GROK.MAX_RESPONSE_LENGTH) {
    return {
        responseId: r.responseId,
        sender: r.sender,
        model: r.model,
        message: r.message?.slice(0, maxLength),
        thinkingTrace: r.thinkingTrace?.slice(0, GROK.MAX_THINKING_LENGTH),
        state: r.state,
        ...(r.partial && { partial: true }),
        ...(r.createTime && { createdAt: r.createTime }),
    };
}

function waitForResponse(conversationId: string | undefined, beforeCount: number, timeoutMs: number): Promise<SentResponse> {
    return new Promise<SentResponse>((resolve, reject) => {
        let settled = false;
        const unsubs: Array<() => void> = [];
        const timer = setTimeout(() => settle(reject, new Error("Timeout waiting for response")), timeoutMs);

        const settle = <T>(done: (value: T) => void, value: T): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            for (const u of unsubs) u();
            done(value);
        };

        const check = (): void => {
            if (settled) return;

            const state = chatState();
            const convId = conversationId ?? state.conversationId;
            if (!convId) return;

            const blocked = blockReason(state);
            if (blocked) return settle(reject, new Error(blocked));

            const responses = responsesFor(convId);
            if (!responses || responses.length <= beforeCount) return;

            const last = latestAssistant(responses, beforeCount - 1);
            if (!last || !isFinal(last)) return;

            settle(resolve, {
                conversationId: convId,
                responseId: last.responseId,
                message: (last.message ?? "").slice(0, GROK.MAX_RESPONSE_LENGTH),
                thinkingTrace: last.thinkingTrace?.slice(0, GROK.MAX_THINKING_LENGTH),
            });
        };

        unsubs.push(ResponseStore.useResponseStore.subscribe(check), ChatPageStore.useChatPageStore.subscribe(check));
        check();
    });
}

async function handleSend(args: GrokArgs): Promise<unknown> {
    const { message, model, conversationId, reasoningMode = "none" } = args;
    if (!message) return { error: "Provide a message to send." };

    try {
        await navigateToChat(conversationId);

        const state = chatState();
        const blocked = blockReason(state);
        if (blocked) return { error: blocked };

        if (model) state.setActiveModelId(model as ModelId);
        state.setReasoningMode(reasoningMode as ReasoningMode);

        const editor = await waitForEditor();

        const convId = conversationId ?? state.conversationId;
        const beforeCount = convId ? (responsesFor(convId)?.length ?? 0) : 0;

        editor.commands.setContent(message);
        editor.commands.focus();
        await sleep(GROK.PRE_SUBMIT_DELAY);
        submitEditor();

        const result = await waitForResponse(convId, beforeCount, GROK.SEND_TIMEOUT);
        return {
            conversationId: result.conversationId,
            responseId: result.responseId,
            model: model ?? state.activeModelId,
            message: result.message,
            thinkingTrace: result.thinkingTrace,
        };
    } catch (err) {
        logger.error("send failed", err);
        return { error: errorMessage(err) };
    }
}

async function handleRead(args: GrokArgs): Promise<unknown> {
    const { conversationId, responseId } = args;
    if (!conversationId && !responseId) return { error: "Provide conversationId or responseId." };

    if (responseId) {
        const cached = ResponseStore.useResponseStore.getState().byId[responseId];
        if (cached && isFinal(cached)) return formatResponse(cached);
    }

    if (conversationId && responseId) {
        try {
            const data = await ApiClients.chatApi.chatLoadResponses({ conversationId, body: { responseIds: [responseId] } });
            const resp = data.responses?.[0] as GrokResponse | undefined;
            return resp ? formatResponse(resp) : { error: "Response not found." };
        } catch (err) {
            return { error: errorMessage(err) };
        }
    }

    if (!conversationId) return { error: "Provide conversationId to list responses or get latest." };

    const responses = responsesFor(conversationId);
    if (!responses?.length) return { error: "No responses found. Is the conversation loaded?" };

    const real = responses.filter(isReal);
    const latest = latestAssistant(real, -1);

    return {
        conversationId,
        latest: latest ? formatResponse(latest) : undefined,
        responses: real.map(r => ({
            responseId: r.responseId,
            sender: r.sender,
            model: r.model,
            message: r.message?.slice(0, GROK.READ_PREVIEW_LENGTH),
        })),
    };
}

interface Mode {
    id: string;
    title: string;
    description?: string;
    availability?: Record<string, unknown>;
}

interface RateLimit {
    remainingQueries?: number;
    totalQueries?: number;
    windowSizeSeconds?: number;
}

async function handleModels(): Promise<unknown> {
    const { modes } = ModesStore.useModesStore.getState() as { modes: Mode[] };

    const results = await Promise.all(modes.map(async m => {
        const base = { id: m.id, title: m.title, description: m.description, available: !!m.availability };
        try {
            const rl: RateLimit = await ApiClients.rateLimitsApi.rateLimitsGetRateLimits({ body: { modelName: m.id } });
            return { ...base, rateLimit: { remaining: rl.remainingQueries, total: rl.totalQueries, windowSeconds: rl.windowSizeSeconds } };
        } catch {
            return base;
        }
    }));

    return serialize(results, GROK.SERIALIZE_DEPTH);
}

const GROK_ACTIONS: ActionMap<GrokArgs> = {
    send: handleSend,
    read: handleRead,
    models: handleModels,
};

export const handleGrok = (args: GrokArgs): unknown => dispatch(GROK_ACTIONS, args);
