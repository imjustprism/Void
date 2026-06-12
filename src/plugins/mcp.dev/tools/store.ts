/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getModuleCache, isBlacklisted, silenceWarns, syncLazyModules } from "@turbopack/patchTurbopack";
import { isObject } from "@utils/guards";

import { SERIALIZE, STORE } from "./constants";
import type { StoreArgs, StoreEntry, ZustandLike } from "./types";
import { type ActionMap, clampConfig, createGenerationalCache, describeValue, dispatch, errorMessage, getPath, isThenable, notFound, serialize } from "./utils";

type StateObj = Record<string, unknown>;
type Change = { key: string; from: unknown; to: unknown };
type Resolved = { store: ZustandLike; resolvedName: string; also?: string[] };

function isZustandStore(value: unknown): value is ZustandLike {
    if (value == null) return false;
    const t = typeof value;
    if (t !== "function" && t !== "object") return false;
    const v = value as Record<string, unknown>;
    return typeof v.getState === "function" && typeof v.setState === "function" && typeof v.subscribe === "function";
}

function resolveStoreName(exportKey: string, valName?: string): string | null {
    if (exportKey.startsWith("use")) return exportKey;
    if (typeof valName === "string" && valName !== STORE.MINIFIED_STORE_NAME) return valName;
    if (exportKey !== "default" && exportKey !== STORE.MINIFIED_STORE_NAME) return exportKey;
    return null;
}

const storeCacheHolder = createGenerationalCache<StoreEntry[]>(
    () => {
        silenceWarns(() => syncLazyModules());
        const stores: StoreEntry[] = [];
        const seen = new WeakSet<object>();
        for (const [id, exports] of getModuleCache()) {
            if (!isObject(exports) || isBlacklisted(exports)) continue;
            const mod = exports as StateObj;
            for (const key in mod) {
                try {
                    const val = mod[key];
                    if (!isZustandStore(val) || seen.has(val)) continue;
                    seen.add(val);
                    const state = val.getState();
                    const keys = isObject(state) ? Object.keys(state) : [];
                    stores.push({ id, name: resolveStoreName(key, val.name), keys: keys.slice(0, STORE.KEYS_PREVIEW) });
                } catch {}
            }
        }
        return stores;
    },
    () => getModuleCache().size,
);
export const clearStoreCache = storeCacheHolder.clear;

function coerceModuleId(query: string | number): number {
    if (typeof query === "number") return query;
    const trimmed = query.trim();
    return trimmed.length ? Number(trimmed) : NaN;
}

function getStoreFromModule(moduleId: number, exportName?: string | null): ZustandLike | null {
    const exports = getModuleCache().get(moduleId);
    if (!isObject(exports)) return null;
    const mod = exports as StateObj;
    if (exportName && isZustandStore(mod[exportName])) return mod[exportName];
    for (const key in mod) {
        try {
            if (isZustandStore(mod[key])) return mod[key];
        } catch {}
    }
    return null;
}

function findStoreByQuery(query: string | number): Resolved | null {
    const stores = storeCacheHolder.get();
    const numQuery = coerceModuleId(query);
    if (Number.isFinite(numQuery)) {
        const store = getStoreFromModule(numQuery);
        return store ? { store, resolvedName: `module:${numQuery}` } : null;
    }

    const lower = String(query).toLowerCase();
    let bestMatch: StoreEntry | null = null;
    let bestLen = Infinity;
    const partialMatches: string[] = [];

    for (const entry of stores) {
        if (!entry.name) continue;
        const nameLower = entry.name.toLowerCase();
        if (nameLower === lower || nameLower === `use${lower}store` || nameLower === `use${lower}`) {
            const store = getStoreFromModule(entry.id, entry.name);
            return store ? { store, resolvedName: entry.name } : null;
        }
        if (nameLower.includes(lower)) {
            partialMatches.push(entry.name);
            if (entry.name.length < bestLen) {
                bestMatch = entry;
                bestLen = entry.name.length;
            }
        }
    }
    if (bestMatch) {
        const store = getStoreFromModule(bestMatch.id, bestMatch.name);
        if (!store) return null;
        const also = partialMatches.filter(n => n !== bestMatch!.name);
        return { store, resolvedName: bestMatch.name ?? `module:${bestMatch.id}`, ...(also.length && { also }) };
    }

    for (const entry of stores) {
        if (entry.keys.some(k => k.toLowerCase().includes(lower))) {
            const store = getStoreFromModule(entry.id, entry.name);
            return store ? { store, resolvedName: entry.name ?? `module:${entry.id}` } : null;
        }
    }
    return null;
}

function requireStore(query: string | number | undefined): Resolved | { error: string; similar?: string[] } {
    if (!query) return { error: "Provide query (store name or module ID)." };
    return findStoreByQuery(query) ?? notFound("Store", String(query), storeCacheHolder.get().map(s => s.name ?? `module:${s.id}`));
}

function diffState(prev: StateObj, cur: StateObj, depth: number, maxChanges: number): Change[] {
    const changes: Change[] = [];
    for (const k of Object.keys(cur)) {
        if (cur[k] !== prev[k] && changes.length < maxChanges)
            changes.push({ key: k, from: serialize(prev[k], depth), to: serialize(cur[k], depth) });
    }
    for (const k of Object.keys(prev)) {
        if (!(k in cur) && changes.length < maxChanges)
            changes.push({ key: k, from: serialize(prev[k], depth), to: "[deleted]" });
    }
    return changes;
}

const DESTRUCTIVE_METHODS = new Set(["clearUser", "logout", "reset", "resetAll", "clearAll", "clearAllOverrides", "deleteUser", "signOut", "clearSession", "refreshSession"]);

function actionList(): unknown {
    return storeCacheHolder.get().map(s => ({ id: s.id, n: s.name, k: s.keys.slice(0, STORE.LIST_KEYS_PREVIEW) }));
}

function actionGet(args: StoreArgs): unknown {
    const found = requireStore(args.query);
    if ("error" in found) return found;
    const state = found.store.getState();
    const defaultDepth = args.path || args.depth != null ? SERIALIZE.DEFAULT_DEPTH : STORE.DEFAULT_DEPTH;
    const depth = clampConfig(args.depth, { default: defaultDepth, max: STORE.MAX_DEPTH });
    const value = args.path ? getPath(state, args.path) : state;
    const out: StateObj = { _store: found.resolvedName, value: serialize(value, depth) };
    if (found.also?.length) out._also = found.also;
    return out;
}

function actionKeys(args: StoreArgs): unknown {
    const found = requireStore(args.query);
    if ("error" in found) return found;
    const target = args.path ? getPath(found.store.getState(), args.path) : found.store.getState();
    const pathField = args.path ? { path: args.path } : {};
    if (!isObject(target)) return { _store: found.resolvedName, ...pathField, keys: [] };
    const keys: Record<string, string> = {};
    for (const k of Object.keys(target)) {
        try {
            keys[k] = describeValue((target as StateObj)[k]);
        } catch {
            keys[k] = "!";
        }
    }
    return { _store: found.resolvedName, ...pathField, keys };
}

function actionMethods(args: StoreArgs): unknown {
    const found = requireStore(args.query);
    if ("error" in found) return found;
    const state = found.store.getState();
    if (!isObject(state)) return { _store: found.resolvedName, methods: {} };
    const methods: Record<string, number> = {};
    for (const k of Object.keys(state)) {
        const fn = (state as StateObj)[k];
        if (typeof fn === "function") methods[k] = fn.length;
    }
    return { _store: found.resolvedName, methods };
}

function actionCall(args: StoreArgs): unknown {
    const { method, callArgs } = args;
    if (!method) return { error: "Provide method name. Use methods action to list available methods." };
    if (DESTRUCTIVE_METHODS.has(method)) return { error: `Method "${method}" is potentially destructive and blocked via MCP. Use evaluateCode if you really need to call it.` };
    const found = requireStore(args.query);
    if ("error" in found) return found;

    const state = found.store.getState();
    const fn = state[method];
    if (typeof fn !== "function") {
        const available = Object.keys(state).filter(k => typeof state[k] === "function").slice(0, STORE.METHODS_PREVIEW);
        return available.length
            ? { error: `No method "${method}"`, available }
            : { error: `No method "${method}". Store has no callable methods.` };
    }

    const depth = clampConfig(args.depth, { default: SERIALIZE.DEFAULT_DEPTH, max: STORE.MAX_DEPTH });
    const stateBefore = found.store.getState();

    const buildResult = (v: unknown): StateObj => {
        const stateAfter = found.store.getState();
        const result: StateObj = { _store: found.resolvedName, result: serialize(v, depth) };
        const changes = isObject(stateBefore) && isObject(stateAfter) ? diffState(stateBefore, stateAfter, STORE.SUBSCRIBE_DEPTH, Infinity) : [];
        if (changes.length) {
            const changed: Record<string, { from: unknown; to: unknown }> = {};
            for (const { key, from, to } of changes) changed[key] = { from, to };
            result.stateChanged = changed;
        }
        return result;
    };

    try {
        const callResult = (fn as (...a: unknown[]) => unknown)(...(Array.isArray(callArgs) ? callArgs : []));
        if (isThenable(callResult)) {
            return callResult.then(buildResult, (e: unknown) => ({ error: errorMessage(e) }));
        }
        return buildResult(callResult);
    } catch (e) {
        return { error: errorMessage(e) };
    }
}

function actionSubscribe(args: StoreArgs): unknown {
    const found = requireStore(args.query);
    if ("error" in found) return found;
    const duration = clampConfig(args.duration, { default: STORE.DEFAULT_DURATION, min: STORE.MIN_DURATION, max: STORE.MAX_DURATION });
    const maxCaptures = clampConfig(args.maxCaptures, { default: STORE.DEFAULT_CAPTURES, min: 1, max: STORE.MAX_CAPTURES });
    const watchPath = args.path;
    const read = (state: StateObj): unknown => watchPath ? getPath(state, watchPath) : state;

    return new Promise<unknown>(resolve => {
        const changes: Array<{ t: number; p?: string; from: unknown; to: unknown }> = [];
        const startTime = Date.now();
        let prev = read(found.store.getState());
        let done = false;

        const finish = (capped: boolean): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unsub();
            resolve({ _store: found.resolvedName, changes, ...(capped ? { capped: true } : {}), ms: Date.now() - startTime });
        };

        const unsub = found.store.subscribe(state => {
            if (done) return;
            const cur = read(state);
            if (cur === prev) return;
            const dt = Date.now() - startTime;

            if (watchPath) {
                changes.push({ t: dt, p: watchPath, from: serialize(prev, STORE.SUBSCRIBE_DEPTH), to: serialize(cur, STORE.SUBSCRIBE_DEPTH) });
            } else if (isObject(cur) && isObject(prev)) {
                for (const c of diffState(prev, cur, STORE.SUBSCRIBE_DEPTH, maxCaptures - changes.length)) {
                    changes.push({ t: dt, p: c.key, from: c.from, to: c.to });
                }
            } else {
                changes.push({ t: dt, from: serialize(prev, STORE.SUBSCRIBE_DEPTH), to: serialize(cur, STORE.SUBSCRIBE_DEPTH) });
            }

            prev = cur;
            if (changes.length >= maxCaptures) finish(true);
        });

        const timer = setTimeout(() => finish(false), duration);
    });
}

const STORE_ACTIONS: ActionMap<StoreArgs> = {
    list: actionList,
    get: actionGet,
    keys: actionKeys,
    methods: actionMethods,
    call: actionCall,
    subscribe: actionSubscribe,
};

export const handleStore = (args: StoreArgs): unknown => dispatch(STORE_ACTIONS, args);
