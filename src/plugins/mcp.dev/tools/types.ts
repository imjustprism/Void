/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ToolArgsMap } from "./contract";

export type ModuleArgs = ToolArgsMap["module"];
export type SearchArgs = ToolArgsMap["search"];
export type EvalArgs = ToolArgsMap["evaluateCode"];
export type PatchArgs = ToolArgsMap["patch"];
export type PluginArgs = ToolArgsMap["plugin"];
export type ReactArgs = ToolArgsMap["react"];
export type StoreArgs = ToolArgsMap["store"];
export type InterceptArgs = ToolArgsMap["intercept"];
export type GrokArgs = ToolArgsMap["grok"];

export type ValidationCode =
    | "find::no-module"
    | "find::ambiguous"
    | "replace::regex-invalid"
    | "replace::match-miss"
    | "replace::backref-invalid"
    | "replace::syntax-error"
    | "group::failed";

export interface ValidationIssue {
    plugin: string;
    find: string;
    code: ValidationCode;
    severity: "error" | "warn";
    message: string;
    moduleId?: number;
    replacementIndex?: number;
    detail?: string;
}

export type ToolArgs = Record<string, unknown>;
export type ToolHandler = (args: ToolArgs) => unknown;

export type { ToolArgsMap, ToolName } from "./contract";

export interface FilterDef {
    props?: string[];
    code?: string[];
    displayName?: string;
    storeName?: string;
    componentByCode?: boolean;
}

export interface SuggestCandidate {
    text: string;
    type: string;
    unique: boolean;
    count: number;
}

export interface DiffChunk {
    at: number;
    orig: string;
    patched: string;
}

export interface SearchMatch {
    id: number;
    s: string;
    len?: number;
    at?: number;
    patched?: boolean;
    truncatedMatch?: boolean;
}

export interface EvalResult {
    ok: true;
    value: unknown;
}

export interface EvalError {
    ok: false;
    error: unknown;
}

export interface LintWarning {
    severity: "error" | "warn" | "info";
    message: string;
    fix?: string;
}

export interface Anchor {
    text: string;
    type: string;
    at: number;
    unique: boolean;
    dist?: number;
    fragile?: boolean;
}

export interface Fiber {
    tag: number;
    type: { displayName?: string; name?: string } | string | null;
    stateNode: Element | null;
    return: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
    memoizedProps: Record<string, unknown> | null;
    memoizedState: FiberState | null;
    _debugOwner?: Fiber | null;
}

export interface FiberState {
    memoizedState: unknown;
    queue: { dispatch?: Function; getSnapshot?: Function } | null;
    next: FiberState | null;
}

export interface ZustandLike {
    getState(): Record<string, unknown>;
    setState(partial: Record<string, unknown>): void;
    subscribe(listener: (state: Record<string, unknown>) => void): () => void;
    name?: string;
}

export interface StoreEntry {
    id: number;
    name: string | null;
    keys: string[];
}

export interface Capture {
    t: number;
    d: number;
    args: unknown;
    ret: unknown;
    err?: string;
}

export interface InterceptState {
    id: number;
    moduleId: number;
    exportKey: string;
    finalKey: string;
    captures: Capture[];
    startTime: number;
    original: Function;
    holder: Record<string, unknown>;
    timer: ReturnType<typeof setTimeout>;
}

export interface PluginInfo {
    name: string;
    enabled: boolean;
    started: boolean;
    required?: boolean;
    desc?: string;
}
