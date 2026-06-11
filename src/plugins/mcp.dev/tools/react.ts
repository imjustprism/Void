/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { REACT } from "./constants";
import type { Fiber, FiberState, ReactArgs } from "./types";
import { type ActionMap, clampConfig, dispatch, type Errorable, serialize } from "./utils";

const NO_FIBER = "No React fiber found on this element";
const NO_ROOT = "No React root found. Is grok.com loaded?";

const hasHooks = (f: Fiber): boolean => f.tag === 0 && !!f.memoizedState;

function fiberName(f: Fiber): string | null {
    const t = f.type;
    if (!t || typeof t === "string") return null;
    return t.displayName ?? t.name ?? null;
}

function findFiberKey(el: Element): string | null {
    for (const k in el) {
        if (k.startsWith("__reactFiber$")) return k;
    }
    return null;
}

function readFiber(el: Element): Fiber | null {
    const k = findFiberKey(el);
    return k ? (el as unknown as Record<string, Fiber>)[k] : null;
}

function getRoot(): Fiber | null {
    for (const el of [document.body, document.getElementById("__next"), document.getElementById("root")]) {
        const fiber = el && readFiber(el);
        if (fiber) return fiber;
    }
    return null;
}

function getFiber(el: Element): Fiber | null {
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        const fiber = readFiber(cur);
        if (fiber) return fiber;
    }
    return null;
}

function walkUp(f: Fiber | null, max: number, test: (f: Fiber) => boolean): Fiber | null {
    const seen = new WeakSet<Fiber>();
    let cur = f;
    for (let d = 0; cur && d < max; d++, cur = cur.return) {
        if (seen.has(cur)) return null;
        seen.add(cur);
        if (test(cur)) return cur;
    }
    return null;
}

function walkFibers(root: Fiber, visit: (fiber: Fiber) => boolean | void, maxProcessed: number): void {
    const visited = new WeakSet<Fiber>();
    const queue: Fiber[] = [root];
    let processed = 0;
    while (queue.length && processed < maxProcessed) {
        const fiber = queue.shift()!;
        if (visited.has(fiber)) continue;
        visited.add(fiber);
        processed++;
        if (visit(fiber) === false) return;
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
    }
}

function walkHookStates(fiber: Fiber, visitor: (state: FiberState, index: number) => boolean | void, maxItems: number): void {
    let state = fiber.memoizedState;
    for (let i = 0; state && i < maxItems; i++, state = state.next) {
        if (visitor(state, i) === false) return;
    }
}

function resolveEl(selector: string): Element | string {
    try {
        return document.querySelector(selector) ?? `No element: ${selector}`;
    } catch {
        return "Invalid CSS selector";
    }
}

function bounds(args: ReactArgs): { maxD: number; lim: number } {
    return {
        maxD: Math.max(0, clampConfig(args.depth, { default: REACT.DEFAULT_DEPTH, max: REACT.MAX_DEPTH })),
        lim: Math.max(1, clampConfig(args.limit, { default: REACT.DEFAULT_LIMIT, max: REACT.MAX_LIMIT })),
    };
}

function requireSelector(args: ReactArgs): Errorable<Element> {
    if (!args.selector) return { error: "Provide CSS selector (required for this action)." };
    const el = resolveEl(args.selector);
    return typeof el === "string" ? { error: el } : el;
}

interface FiberCtx {
    fiber: Fiber;
    maxD: number;
    lim: number;
}

function fiberCtx(args: ReactArgs): FiberCtx | { error: string } {
    const el = requireSelector(args);
    if (!(el instanceof Element)) return el;
    const fiber = getFiber(el);
    if (!fiber) return { error: NO_FIBER };
    return { fiber, ...bounds(args) };
}

function actionFind(args: ReactArgs): unknown {
    const { componentName } = args;
    if (!componentName) return { error: "Provide componentName." };
    const root = getRoot();
    if (!root) return { error: NO_ROOT };

    const { lim } = bounds(args);
    const lower = componentName.toLowerCase();
    type Entry = { name: string; d: number; props?: string[]; s?: boolean; count?: number };
    const found: Entry[] = [];
    const byName = args.includeProps ? null : new Map<string, Entry>();

    walkFibers(root, f => {
        if (found.length >= lim) return false;
        const nm = fiberName(f);
        if (!nm?.toLowerCase().includes(lower)) return;
        const existing = byName?.get(nm);
        if (existing) {
            existing.count = (existing.count ?? 1) + 1;
            return;
        }
        const entry: Entry = { name: nm, d: 0 };
        if (args.includeProps && f.memoizedProps) {
            const pk = Object.keys(f.memoizedProps).filter(k => k !== "children");
            if (pk.length) entry.props = pk.slice(0, REACT.PROP_KEYS_PREVIEW);
        }
        if (f.memoizedState) entry.s = true;
        found.push(entry);
        byName?.set(nm, entry);
    }, REACT.MAX_PROCESS);

    if (!found.length) return { error: `No components matching "${componentName}" found. Try a partial name or use the 'root' action to list all components.` };
    return found;
}

function actionRoot(): unknown {
    const root = getRoot();
    if (!root) return { error: NO_ROOT };
    const seen = new Set<string>();
    walkFibers(root, f => {
        const nm = fiberName(f);
        if (nm && nm.length >= REACT.MIN_COMPONENT_NAME && seen.size < REACT.MAX_NAMED) seen.add(nm);
    }, REACT.MAX_PROCESS);
    return [...seen].toSorted();
}

function actionQuery(args: ReactArgs): unknown {
    if (!args.selector) return { error: "Provide CSS selector (required for this action)." };
    const { lim } = bounds(args);
    let elements: NodeListOf<Element>;
    try {
        elements = document.querySelectorAll(args.selector);
    } catch {
        return { error: "Invalid CSS selector" };
    }
    const els: Array<Record<string, unknown>> = [];
    for (let i = 0, l = Math.min(elements.length, lim); i < l; i++) {
        const e = elements[i];
        const r = e.getBoundingClientRect();
        const item: Record<string, unknown> = { tag: e.tagName.toLowerCase() };
        if (e.id) item.id = e.id;
        if (e.className) item.cls = e.className.toString().slice(0, REACT.TEXT_SLICE);
        item.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
        const fiber = getFiber(e);
        const comp = fiber && walkUp(fiber, REACT.WALK_UP_DEPTH, f => !!fiberName(f));
        if (comp) item.component = fiberName(comp);
        els.push(item);
    }
    return { total: elements.length, els };
}

function actionFiber(args: ReactArgs): unknown {
    const ctx = fiberCtx(args);
    if ("error" in ctx) return ctx;

    const nodes: Array<Record<string, unknown>> = [];
    walkUp(ctx.fiber, ctx.maxD, cur => {
        const nm = fiberName(cur);
        const node: Record<string, unknown> = nm ? { n: nm } : { t: cur.tag };
        if (args.includeProps && cur.memoizedProps) {
            const pk = Object.keys(cur.memoizedProps).filter(k => k !== "children");
            if (pk.length) node.p = pk.slice(0, REACT.FIBER_PROP_KEYS);
        }
        if (cur.memoizedState) node.s = true;
        nodes.push(node);
        return false;
    });
    return nodes;
}

function actionProps(args: ReactArgs): unknown {
    const ctx = fiberCtx(args);
    if ("error" in ctx) return ctx;
    const target = walkUp(ctx.fiber, ctx.maxD, f => !!f.memoizedProps && !!fiberName(f));
    if (!target) return { error: "No component with props found walking up from this element" };
    return { c: fiberName(target), props: serialize(target.memoizedProps) };
}

function describeHook(state: FiberState): Record<string, unknown> {
    const ms = state.memoizedState;
    if (state.queue?.dispatch) return { t: "state", v: serialize(ms, 1) };
    if (state.queue?.getSnapshot) return { t: "store", v: serialize(ms, 1) };
    if (ms != null && typeof ms === "object") {
        const obj = ms as Record<string, unknown>;
        if ("current" in obj) return { t: "ref", v: serialize(obj.current, 1) };
        if ("create" in obj && "deps" in obj) return { t: "effect", deps: (obj.deps as unknown[])?.length ?? null };
    }
    if (Array.isArray(ms) && ms.length === 2 && Array.isArray(ms[1])) {
        return typeof ms[0] === "function" ? { t: "cb", deps: ms[1].length } : { t: "memo", v: serialize(ms[0], 1), deps: ms[1].length };
    }
    const h: Record<string, unknown> = { t: "?" };
    if (ms != null) h.v = serialize(ms, 1);
    return h;
}

function actionHooks(args: ReactArgs): unknown {
    const ctx = fiberCtx(args);
    if ("error" in ctx) return ctx;
    const target = walkUp(ctx.fiber, ctx.maxD, hasHooks);
    if (!target) return { error: "No function component with hooks found" };

    const hooks: Array<Record<string, unknown>> = [];
    walkHookStates(target, state => { hooks.push(describeHook(state)); }, REACT.MAX_HOOKS);
    return { c: fiberName(target), hooks };
}

function actionState(args: ReactArgs): unknown {
    const ctx = fiberCtx(args);
    if ("error" in ctx) return ctx;
    const target = walkUp(ctx.fiber, ctx.maxD, hasHooks);
    if (!target) return { error: "No useState hooks found on nearest function component" };

    const state: unknown[] = [];
    walkHookStates(target, hook => {
        if (hook.queue?.dispatch) state.push(serialize(hook.memoizedState, 2));
    }, REACT.MAX_STATE_VALUES);
    return { c: fiberName(target), state };
}

function actionOwner(args: ReactArgs): unknown {
    const ctx = fiberCtx(args);
    if ("error" in ctx) return ctx;

    const owners: string[] = [];
    const start = ctx.fiber._debugOwner ?? ctx.fiber.return ?? null;
    if (start) {
        walkUp(start, ctx.maxD, cur => {
            const nm = fiberName(cur);
            if (nm) owners.push(nm);
            return owners.length >= ctx.lim;
        });
    }
    if (!owners.length) return { error: "No named owner components found. _debugOwner may be stripped in production builds, try the 'fiber' action instead." };
    return owners;
}

function actionTree(args: ReactArgs): unknown {
    const el = requireSelector(args);
    if (!(el instanceof Element)) return el;
    const { maxD } = bounds(args);
    const breadth = Math.max(1, clampConfig(args.breadth, { default: REACT.DEFAULT_BREADTH, max: REACT.MAX_BREADTH }));

    const build = (node: Element, d: number): Record<string, unknown> => {
        const info: Record<string, unknown> = { tag: node.tagName.toLowerCase() };
        if (node.id) info.id = node.id;
        if (node.classList?.length) info.cls = [...node.classList].slice(0, REACT.MAX_CLASS_PREVIEW);
        if (!node.children.length && node.textContent) info.txt = node.textContent.slice(0, REACT.TEXT_SLICE);
        if (d > 0 && node.children.length) {
            const ch: Array<Record<string, unknown>> = [];
            for (let i = 0, l = Math.min(node.children.length, breadth); i < l; i++) ch.push(build(node.children[i], d - 1));
            info.ch = ch;
            if (node.children.length > breadth) info.more = node.children.length - breadth;
        }
        return info;
    };
    return build(el, Math.min(maxD, REACT.MAX_TREE_DEPTH));
}

const REACT_ACTIONS: ActionMap<ReactArgs> = {
    find: actionFind,
    root: actionRoot,
    query: actionQuery,
    fiber: actionFiber,
    props: actionProps,
    hooks: actionHooks,
    state: actionState,
    tree: actionTree,
    owner: actionOwner,
};

export const handleReact = (args: ReactArgs): unknown => dispatch(REACT_ACTIONS, args);
