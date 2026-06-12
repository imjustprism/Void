/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { plugins } from "@api/PluginManager";
import { getModuleCache, getRuntimeFactoryRegistry, getRuntimeModuleCache, patches, patchStats } from "@turbopack/patchTurbopack";
import {
    extractAndLoadChunks,
    filters,
    find,
    findAll,
    findBulk,
    findComponentByCode,
    findCssClasses,
    findExportedComponent,
    findModuleFactory,
    findStore,
    importModule,
    requireModule,
} from "@turbopack/turbopack";
import { type FilterFn, type PatchedModuleFactory, SYM_ORIGINAL, SYM_PATCHED_BY, SYM_PATCHED_CODE } from "@turbopack/types";
import { isObject } from "@utils/guards";

import { MODULE } from "./constants";
import type { DiffChunk, FilterDef, ModuleArgs } from "./types";
import {
    type ActionMap,
    attachPatchInfo,
    clampConfig,
    createGenerationalCache,
    describeValue,
    dispatch,
    type Errorable,
    errorMessage,
    extractSuggestAnchors,
    findModuleId,
    getAllFactorySources,
    getFactorySource,
    getFactorySourceCache,
    getPatchedSource,
    re,
    requireModuleExports,
    safeOffset,
    serialize,
} from "./utils";

type Result = Record<string, unknown>;

const err = (message: string, extra?: Result): Result => ({ error: message, ...extra });
const NEED_ID = err("Provide module id.");
const NEED_CODE = err("Provide code strings.");

function findSharedFactoryIds(id: number, src: string): number[] {
    const siblings: number[] = [];
    for (const [fid, fsrc] of getFactorySourceCache()) {
        if (fid !== id && fsrc === src) siblings.push(fid);
    }
    return siblings;
}

function attachSharedInfo(result: Result, siblings: number[]): void {
    result.sharedWith = siblings.slice(0, MODULE.MAX_SHARED_WITH);
    if (siblings.length > MODULE.MAX_SHARED_WITH) result.sharedTotal = siblings.length;
}

function attachModuleMetadata(result: Result, id: number): void {
    const src = getFactorySource(id);
    if (src) {
        result.len = src.length;
        const siblings = findSharedFactoryIds(id, src);
        if (siblings.length) attachSharedInfo(result, siblings);
    }
    attachPatchInfo(result, id);
}

function requireFactorySource(id: number | undefined): Errorable<{ src: string; id: number }> {
    if (id == null) return NEED_ID as { error: string };
    const src = getFactorySource(id);
    if (!src) return err(`Module ${id} not found.`) as { error: string };
    return { src, id };
}

const whereUsedCacheHolder = createGenerationalCache(
    () => {
        const index = new Map<number, Array<{ id: number; n: number }>>();
        const registry = getRuntimeFactoryRegistry();
        if (!registry) return index;

        const importRe = re.turbopackImport();
        const sourceCache = getFactorySourceCache();
        for (const [moduleId] of registry) {
            const src = sourceCache.get(moduleId);
            if (!src) continue;
            const counts = new Map<number, number>();
            importRe.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = importRe.exec(src)) !== null) {
                const depId = Number(m[1]);
                if (depId !== moduleId) counts.set(depId, (counts.get(depId) ?? 0) + 1);
            }
            for (const [depId, count] of counts) {
                const list = index.get(depId);
                if (list) list.push({ id: moduleId, n: count });
                else index.set(depId, [{ id: moduleId, n: count }]);
            }
        }

        for (const list of index.values()) list.sort((a, b) => b.n - a.n);
        return index;
    },
    () => getFactorySourceCache().size,
);
export const clearWhereUsedCache = whereUsedCacheHolder.clear;

function isFunctionBrace(src: string, braceIdx: number): boolean {
    let j = braceIdx - 1;
    while (j >= 0 && (src[j] === " " || src[j] === "\t")) j--;
    if (j < 0) return false;
    const ch = src[j];
    if (ch === ")" || ch === ">") return true;
    return ch !== "," && ch !== "(" && ch !== ":" && ch !== "[";
}

function skipQuote(src: string, i: number): number {
    const q = src[i];
    for (let j = i + 1; j < src.length; j++) {
        if (src[j] === "\\") { j++; continue; }
        if (src[j] === q) return j;
    }
    return src.length - 1;
}

function extractFunctionAt(src: string, patternIdx: number): { start: number; end: number } | null {
    let openBrace = -1;
    let hitSemicolon = false;
    const forwardLimit = Math.min(src.length, patternIdx + MODULE.FUNCTION_AT_FORWARD);
    for (let i = patternIdx; i < forwardLimit; i++) {
        const ch = src[i];
        if (ch === '"' || ch === "'" || ch === "`") { i = skipQuote(src, i); continue; }
        if (ch === "{") {
            if (isFunctionBrace(src, i)) {
                openBrace = i;
                break;
            }
            let depth = 1;
            let k = i + 1;
            while (k < src.length && depth > 0) {
                const kc = src[k];
                if (kc === '"' || kc === "'" || kc === "`") { k = skipQuote(src, k) + 1; continue; }
                if (kc === "{") depth++;
                else if (kc === "}") depth--;
                k++;
            }
            i = k - 1;
            continue;
        }
        if (ch === "}" || ch === ";") {
            hitSemicolon = ch === ";";
            break;
        }
    }

    if (openBrace < 0 && hitSemicolon) {
        const lookback = src.slice(Math.max(0, patternIdx - MODULE.FUNCTION_AT_LOOKBACK), patternIdx);
        const arrowIdx = lookback.lastIndexOf("=>");
        if (arrowIdx >= 0) {
            const arrowAbsIdx = Math.max(0, patternIdx - MODULE.FUNCTION_AT_LOOKBACK) + arrowIdx;
            const between = src.slice(arrowAbsIdx + 2, patternIdx);
            if (!between.includes("{")) {
                let headerStart = arrowAbsIdx;
                while (headerStart > 0 && patternIdx - headerStart < MODULE.FUNCTION_AT_HEADER_MAX) {
                    const ch = src[headerStart - 1];
                    if (ch === ";" || ch === "}" || ch === "\n") break;
                    headerStart--;
                }
                let end = patternIdx;
                while (end < src.length && src[end] !== ";") {
                    const ec = src[end];
                    if (ec === '"' || ec === "'" || ec === "`") { end = skipQuote(src, end) + 1; continue; }
                    end++;
                }
                if (end < src.length) end++;
                return { start: headerStart, end };
            }
        }
    }

    if (openBrace < 0) {
        let braceCount = 0;
        for (let i = patternIdx; i >= 0; i--) {
            const ch = src[i];
            if (ch === '"' || ch === "'" || ch === "`") {
                let j = i - 1;
                while (j >= 0 && src[j] !== ch) {
                    if (src[j] === "\\" && j > 0) j--;
                    j--;
                }
                i = j + 1;
                continue;
            }
            if (ch === "}") braceCount++;
            else if (ch === "{") {
                if (braceCount > 0) braceCount--;
                else {
                    openBrace = i;
                    break;
                }
            }
        }
    }
    if (openBrace < 0) return null;

    let headerStart = openBrace;
    while (headerStart > 0 && openBrace - headerStart < MODULE.FUNCTION_AT_HEADER_MAX) {
        const ch = src[headerStart - 1];
        if (ch === ";" || ch === "}" || ch === "\n") break;
        headerStart--;
    }

    let fnEnd = openBrace + 1;
    let braceCount = 1;
    while (fnEnd < src.length && braceCount > 0) {
        const ch = src[fnEnd];
        if (ch === '"' || ch === "'" || ch === "`") { fnEnd = skipQuote(src, fnEnd) + 1; continue; }
        if (ch === "{") braceCount++;
        else if (ch === "}") braceCount--;
        fnEnd++;
    }

    return { start: headerStart, end: fnEnd };
}

function findDiffs(orig: string, patched: string, budget: number): DiffChunk[] {
    const pad = MODULE.DIFF_CONTEXT_PAD;
    const diffs: DiffChunk[] = [];
    let used = 0;
    let oi = 0;
    let pi = 0;

    while (oi < orig.length && pi < patched.length && used < budget) {
        if (orig[oi] === patched[pi]) {
            oi++;
            pi++;
            continue;
        }

        const origCtxStart = Math.max(0, oi - pad);
        const patchCtxStart = Math.max(0, pi - pad);

        let oe = oi;
        let pe = pi;
        const scan = Math.min(orig.length - oi, patched.length - pi, MODULE.DIFF_SCAN_LIMIT);
        let resynced = false;
        for (let len = 1; len < scan; len++) {
            const origSlice = orig.slice(oi + len, oi + len + MODULE.DIFF_RESYNC_SLICE);
            if (origSlice.length < MODULE.DIFF_RESYNC_SLICE) break;
            const pj = patched.indexOf(origSlice, pi);
            if (pj !== -1) {
                oe = oi + len;
                pe = pj;
                resynced = true;
                break;
            }
            const patchSlice = patched.slice(pi + len, pi + len + MODULE.DIFF_RESYNC_SLICE);
            if (patchSlice.length < MODULE.DIFF_RESYNC_SLICE) break;
            const oj = orig.indexOf(patchSlice, oi);
            if (oj !== -1) {
                oe = oj;
                pe = pi + len;
                resynced = true;
                break;
            }
        }

        if (!resynced) {
            diffs.push({ at: oi, orig: orig.slice(origCtxStart, oi + MODULE.DIFF_UNSYNCED_CONTEXT), patched: patched.slice(patchCtxStart, pi + MODULE.DIFF_UNSYNCED_CONTEXT) });
            break;
        }

        const origChunk = orig.slice(origCtxStart, Math.min(oe + pad, orig.length));
        const patchChunk = patched.slice(patchCtxStart, Math.min(pe + pad, patched.length));
        used += origChunk.length + patchChunk.length;
        diffs.push({ at: oi, orig: origChunk, patched: patchChunk });
        oi = oe;
        pi = pe;
    }

    return diffs;
}

const isFn = (v: unknown): boolean => typeof v === "function";
const FILTER_BUILDERS: Record<string, (v: unknown) => boolean> = {
    fn: isFn,
    function: isFn,
    string: v => typeof v === "string",
    number: v => typeof v === "number",
    boolean: v => typeof v === "boolean",
    object: v => isObject(v),
    array: v => Array.isArray(v),
    component: v => typeof v === "function" || (v != null && typeof v === "object" && (v as Record<string, unknown>).$$typeof != null),
};

const VALID_FILTER_TYPES = `${Object.keys(FILTER_BUILDERS).join(", ")}, hasProps:a,b, code:pattern`;

function buildFilter(filterType: string): FilterFn | string {
    const builtin = FILTER_BUILDERS[filterType];
    if (builtin) return builtin;
    if (filterType.startsWith("hasProps:")) return filters.byProps(...filterType.slice(9).split(","));
    if (filterType.startsWith("code:")) return filters.byCode(filterType.slice(5));
    return `Unknown filter type "${filterType}". Valid types: ${VALID_FILTER_TYPES}`;
}

function resolveFilter(args: FilterDef): { filter: FilterFn; type: string } | null {
    if (args.storeName) return { filter: filters.byStoreName(args.storeName), type: "storeName" };
    if (args.displayName) return { filter: filters.byDisplayName(args.displayName), type: "displayName" };
    if (args.code?.length && args.componentByCode) return { filter: filters.componentByCode(...args.code), type: "componentByCode" };
    if (args.props?.length) return { filter: filters.byProps(...args.props), type: "props" };
    if (args.code?.length) return { filter: filters.byCode(...args.code), type: "code" };
    return null;
}

function describeMatch(mod: unknown): Result {
    const moduleId = findModuleId(mod);
    const result: Result = { id: moduleId, exports: serialize(mod, 1) };
    if (moduleId != null) attachModuleMetadata(result, moduleId);
    return result;
}

function findSingleError(filterType: string, args: ModuleArgs): Result {
    const cache = getModuleCache();
    const { props } = args;
    if (filterType === "props" && props?.length) {
        let partial = 0;
        let onDefault = 0;
        for (const [, exports] of cache) {
            if (exports == null || typeof exports !== "object") continue;
            try {
                const exp = exports as Record<string, unknown>;
                if (props.some(p => exp[p] !== undefined)) partial++;
                const def = exp.default;
                if (def != null && typeof def === "object" && props.every(p => (def as Record<string, unknown>)[p] !== undefined)) onDefault++;
            } catch {}
        }
        if (onDefault) return err(`${onDefault} module(s) have [${props}] on .default, not top-level`);
        if (partial) return err(`${partial} modules have some of [${props}] but not all`);
    }
    if (filterType === "code") return err(`No match in ${cache.size} modules`, { hint: "find with code searches exported function toString(), not factory source. Use search tool or locate by:factory to search factory source instead." });
    if (filterType === "componentByCode") return err(`No match in ${cache.size} modules`, { hint: "componentByCode checks function source, $$typeof.type, and .render. Use search tool for factory source." });
    if (filterType === "storeName") return err(`No store "${args.storeName}" found`, { hint: "storeName is case-sensitive and auto-prefixes 'use'/suffixes 'Store' (e.g. 'ChatPage' → useChatPageStore). Use the store tool's list action to see all stores, or the store tool with a partial query for fuzzy matching." });
    return err(`No match in ${cache.size} modules`);
}

function actionFind(args: ModuleArgs): unknown {
    const limit = Math.floor(args.limit ?? 1);

    if (limit > 1) {
        const resolved = resolveFilter(args);
        if (!resolved) return err("Provide props, code, displayName, or storeName.");
        const seen = new Set<number>();
        const mods: Array<{ mod: unknown; id: number }> = [];
        for (const mod of findAll(resolved.filter)) {
            const id = findModuleId(mod);
            if (id == null || seen.has(id)) continue;
            seen.add(id);
            mods.push({ mod, id });
        }
        if (!mods.length) return [];
        const cap = clampConfig(args.limit, MODULE.DEFAULT_FIND_ALL, MODULE.MAX_FIND_ALL);
        const off = safeOffset(args.offset);
        const sliced = mods.slice(off, off + cap);
        const results: Result[] = sliced.map(({ mod }) => describeMatch(mod));
        if (mods.length > off + cap) results.push({ truncated: mods.length, showing: `${off}-${off + sliced.length}` });
        return results;
    }

    const { code } = args;
    let mod: unknown = null;
    let filterType = "";
    if (args.storeName) {
        mod = findStore(args.storeName);
        filterType = "storeName";
    } else if (code?.length && args.componentByCode) {
        mod = findComponentByCode(...code);
        filterType = "componentByCode";
    } else {
        const resolved = resolveFilter(args);
        if (!resolved) return err("Provide props, code, displayName, or storeName.");
        mod = find(resolved.filter);
        filterType = resolved.type;
    }
    if (!mod) return findSingleError(filterType, args);

    const result = describeMatch(mod);
    if (filterType === "storeName" && typeof (mod as Record<string, unknown>).getState === "function") {
        try {
            const state = (mod as { getState(): Record<string, unknown> }).getState();
            if (state && typeof state === "object") result.stateKeys = Object.keys(state);
        } catch {}
    }
    return result;
}

function actionFindBulk(args: ModuleArgs): unknown {
    const filterDefs = args.filters;
    if (!Array.isArray(filterDefs) || filterDefs.length < 2) return err("Provide filters array (2+), each: {props?, code?, displayName?, storeName?}.");
    const builtFilters = filterDefs.map(def => resolveFilter(def)?.filter ?? null);
    const invalid = builtFilters.findIndex(f => !f);
    if (invalid !== -1) return err(`Filter[${invalid}] needs props, code, displayName, or storeName`);
    const results = findBulk(...(builtFilters as FilterFn[]));
    return results.map((m, i) => m
        ? { i, id: findModuleId(m), exports: serialize(m, 1) }
        : { i, found: false, filter: filterDefs[i] });
}

function actionFindComponent(args: ModuleArgs): unknown {
    const { props, code } = args;
    let comp: unknown = null;
    if (code?.length) {
        comp = findComponentByCode(...code);
        if (!comp) return err(`No component matching code [${code}]. componentByCode checks function source, $$typeof.type, and .render.`);
    } else if (props?.length) {
        comp = findExportedComponent(...props);
        if (!comp) return err(`No component "${props[0]}". Try code param for source matching, react find, or search factory source.`);
    } else {
        return err("Provide component name(s) in props, or code strings in code.");
    }
    const moduleId = findModuleId(comp);
    const fn = comp as { displayName?: string; name?: string };
    const result: Result = { id: moduleId, name: fn.displayName ?? fn.name ?? props?.[0] ?? null };
    if (moduleId != null) {
        attachModuleMetadata(result, moduleId);
        const exports = getModuleCache().get(moduleId);
        if (exports && typeof exports === "object") result.keys = Object.keys(exports as object).slice(0, MODULE.EXPORT_KEYS_SLICE);
    }
    return result;
}


function actionLocate(args: ModuleArgs): unknown {
    const { code } = args;
    if (!code?.length) return NEED_CODE;
    const found = findModuleFactory(...code);
    if (!found) return err(`No factory matches [${code}]`);
    const [factoryId] = found;
    const modCache = getModuleCache();
    const loaded = modCache.has(factoryId);
    const result: Result = { id: factoryId, loaded };
    if (loaded) result.exports = serialize(modCache.get(factoryId), 1);
    attachModuleMetadata(result, factoryId);
    return result;
}

function inspectExports(args: ModuleArgs): unknown {
    const { id } = args;
    if (id == null) return NEED_ID;
    const check = requireModuleExports(id);
    if ("error" in check) return check;
    const target = (check.exports != null && typeof check.exports === "object" ? check.exports : { default: check.exports }) as Record<string, unknown>;
    const keys = Object.keys(target);
    const cap = clampConfig(args.limit, MODULE.DEFAULT_EXPORT_KEYS, MODULE.MAX_EXPORT_KEYS);
    const result: Record<string, string> = {};
    for (let i = 0, l = Math.min(keys.length, cap); i < l; i++) {
        try {
            result[keys[i]] = describeValue(target[keys[i]]);
        } catch {
            result[keys[i]] = "!";
        }
    }
    if (keys.length > cap) result["…"] = `+${keys.length - cap}`;
    return result;
}

function inspectImports(args: ModuleArgs): unknown {
    const factory = requireFactorySource(args.id);
    if ("error" in factory) return factory;
    const { src, id } = factory;
    const sync = new Set<number>();
    const async = new Set<number>();
    const syncRe = re.turbopackSyncImport();
    const asyncRe = re.turbopackAsyncImport();
    let m: RegExpExecArray | null;
    while ((m = syncRe.exec(src)) !== null) sync.add(Number(m[1]));
    while ((m = asyncRe.exec(src)) !== null) async.add(Number(m[1]));
    const cache = getModuleCache();
    const syncArr = [...sync];
    const result: Result = { id, sync: syncArr, loaded: syncArr.filter(dep => cache.has(dep)).length };
    if (async.size) {
        const asyncArr = [...async];
        result.async = asyncArr;
        result.asyncLoaded = asyncArr.filter(dep => cache.has(dep)).length;
    }
    return result;
}

function inspectNamed(args: ModuleArgs): unknown {
    const factory = requireFactorySource(args.id);
    if ("error" in factory) return factory;
    const { src, id } = factory;
    const named: Array<{ name: string; mid?: number }> = [];
    const exportDefRe = re.turbopackExportDef();
    let m: RegExpExecArray | null;
    while ((m = exportDefRe.exec(src)) !== null) {
        const mid = m[2] ? Number(m[2]) : undefined;
        const nameRe = re.exportInner();
        let nm: RegExpExecArray | null;
        while ((nm = nameRe.exec(m[1])) !== null) {
            named.push(mid !== undefined ? { name: nm[1], mid } : { name: nm[1] });
        }
    }
    const cap = clampConfig(args.limit, MODULE.DEFAULT_NAMED_EXPORTS, MODULE.MAX_NAMED_EXPORTS);
    if (named.length <= cap) return { id, named };
    return { id, named: named.slice(0, cap), total: named.length };
}

function inspectStats(): unknown {
    const cache = getModuleCache();
    const registry = getRuntimeFactoryRegistry();
    const rtCache = getRuntimeModuleCache();
    const rtSize = rtCache ? Object.keys(rtCache).length : 0;

    let stale = 0;
    let missing = 0;
    if (rtCache) {
        for (const rid in rtCache) {
            const mod = rtCache[rid];
            if (mod?.exports == null) continue;
            const numId = Number(rid);
            if (!cache.has(numId)) missing++;
            else if (cache.get(numId) !== mod.exports) stale++;
        }
    }

    return {
        cached: cache.size,
        factories: registry?.size ?? 0,
        plugins: Object.keys(plugins).length,
        rt: rtSize,
        stale,
        missing,
        patches: patches.length,
        applied: patchStats.applied,
        errors: patchStats.errors,
        noEffect: patchStats.noEffect,
        runtimeFallbacks: patchStats.runtimeFallbacks,
        patched: patchStats.patchedModules.size,
    };
}

const INSPECT_FACETS = {
    exports: inspectExports,
    imports: inspectImports,
    named: inspectNamed,
    stats: inspectStats,
} satisfies Record<NonNullable<ModuleArgs["facet"]>, (args: ModuleArgs) => unknown>;

function actionInspect(args: ModuleArgs): unknown {
    return INSPECT_FACETS[args.facet ?? "exports"](args);
}

function sourceFull(args: ModuleArgs): unknown {
    const { id } = args;
    if (id == null) return NEED_ID;
    const patchedCode = args.patched ? getPatchedSource(id) : null;
    const src = patchedCode ?? getFactorySource(id);
    if (!src) return err(`Module ${id} not found.`);
    const cap = clampConfig(args.limit, MODULE.DEFAULT_SOURCE_LIMIT, MODULE.MAX_SOURCE_LIMIT);
    const rawOffset = Math.floor(args.offset ?? 0);
    const offsetClamped = rawOffset < 0 || rawOffset > src.length;
    let start = Math.max(0, Math.min(rawOffset, src.length));
    let searchIdx = -1;
    if (args.search) {
        searchIdx = src.indexOf(args.search, start);
        if (searchIdx === -1) return { len: src.length, searchNotFound: args.search };
        start = Math.max(0, searchIdx - MODULE.SEARCH_CONTEXT_PAD);
    }
    const result: Result = { len: src.length, at: start, src: src.slice(start, start + cap) };
    if (offsetClamped) result.offsetClamped = true;
    if (src.length > cap) result.hint = `Showing ${cap}/${src.length} chars. Use offset/search to paginate, or increase limit.`;
    if (args.search) {
        result.searchAt = searchIdx - start;
        let occurrences = 0;
        let pos = 0;
        while ((pos = src.indexOf(args.search, pos)) !== -1) {
            occurrences++;
            pos += args.search.length || 1;
        }
        if (occurrences > 1) result.searchOccurrences = occurrences;
    }
    if (patchedCode) result.patched = true;
    attachPatchInfo(result, id);
    const origSrc = patchedCode ? getFactorySource(id) : src;
    if (origSrc) {
        const siblingIds = findSharedFactoryIds(id, origSrc);
        if (siblingIds.length) attachSharedInfo(result, siblingIds);
    }
    return result;
}

function sourceDiff(args: ModuleArgs): unknown {
    const { id } = args;
    if (id == null) return NEED_ID;
    const factory = getRuntimeFactoryRegistry()?.get(id) as PatchedModuleFactory | undefined;
    if (!factory) return err(`Module ${id} not found.`);
    const patchedCode = factory[SYM_PATCHED_CODE];
    if (!patchedCode) return { patched: false };
    const orig = String(factory[SYM_ORIGINAL] ?? factory);
    const diffBudget = clampConfig(args.limit, MODULE.DEFAULT_DIFF_SLICE, MODULE.MAX_DIFF_SLICE);
    return { patched: true, by: factory[SYM_PATCHED_BY], origLen: orig.length, patchedLen: patchedCode.length, changes: findDiffs(orig, patchedCode, diffBudget) };
}

function sourceFunction(args: ModuleArgs): unknown {
    if (!args.pattern) return err("Provide pattern.");
    const factory = requireFactorySource(args.id);
    if ("error" in factory) return factory;
    const { src } = factory;
    const idx = src.indexOf(args.pattern);
    if (idx < 0) return err("Pattern not found.");
    const fn = extractFunctionAt(src, idx);
    if (!fn) return err("Cannot determine function boundaries.");
    const maxLen = Math.min(args.limit ?? MODULE.FUNCTION_AT_MAX, MODULE.FUNCTION_AT_MAX);
    const fnSrc = src.slice(fn.start, fn.end);
    const truncated = fnSrc.length > maxLen;
    return {
        at: idx,
        start: fn.start,
        len: fnSrc.length,
        truncated,
        ...(truncated && { hint: `Function is ${fnSrc.length} chars, showing first ${maxLen} (maximum). Use source action with search/offset for full access.` }),
        src: fnSrc.slice(0, maxLen),
    };
}

const SOURCE_MODES = {
    full: sourceFull,
    diff: sourceDiff,
    function: sourceFunction,
} satisfies Record<NonNullable<ModuleArgs["mode"]>, (args: ModuleArgs) => unknown>;

function actionSource(args: ModuleArgs): unknown {
    return SOURCE_MODES[args.mode ?? "full"](args);
}

function actionLoad(args: ModuleArgs): unknown {
    if (args.chunks) {
        const { code } = args;
        if (!code?.length) return err("Provide code to identify the chunk-loading factory.");
        return extractAndLoadChunks(code).then(
            (loaded: boolean) => ({ loaded }),
            (e: unknown) => err(errorMessage(e)),
        );
    }

    const { id } = args;
    if (id == null) return NEED_ID;
    const cache = getModuleCache();
    if (cache.has(id)) return { id, loaded: true, exports: serialize(cache.get(id)) };

    const registry = getRuntimeFactoryRegistry();
    if (!registry?.has(id)) return err(`No factory for ${id}`);

    if (args.async) {
        return importModule(id).then(
            (mod: unknown) => ({ id, loaded: true, exports: serialize(mod) }),
            (e: unknown) => err(errorMessage(e)),
        );
    }

    const mod = requireModule(id);
    if (mod == null) return err(`Module ${id} load returned null`);
    return { id, loaded: true, exports: serialize(mod) };
}

function actionMapMangled(args: ModuleArgs): unknown {
    const { code } = args;
    if (!code?.length) return NEED_CODE;
    const mapperDefs = args.mappers;
    if (!isObject(mapperDefs)) return err("Provide mappers: {name: filterType}. Types: fn/string/number/boolean/object/array/component/hasProps:a,b/code:pattern");
    const found = findModuleFactory(...code);
    if (!found) return err(`No factory matches [${code}]`);
    const [factoryId] = found;
    const cache = getModuleCache();
    if (!cache.has(factoryId)) {
        try { requireModule(factoryId); } catch (e: unknown) {
            return { id: factoryId, error: `Load failed: ${errorMessage(e)}` };
        }
        if (!cache.has(factoryId)) return { id: factoryId, error: "Not loaded." };
    }
    const exports = cache.get(factoryId);
    if (typeof exports !== "object" || exports == null) return { id: factoryId, error: "Not an object" };

    const builtFilters: Record<string, FilterFn> = {};
    for (const [name, filterType] of Object.entries(mapperDefs)) {
        if (typeof filterType !== "string") return err(`Mapper "${name}" must be a string filter type, got ${typeof filterType}`);
        const filter = buildFilter(filterType);
        if (typeof filter === "string") return err(filter);
        builtFilters[name] = filter;
    }

    const mapped: Result = {};
    const keys: Record<string, string> = {};
    const filterEntries = Object.entries(builtFilters);
    let count = 0;
    const exp = exports as Record<string, unknown>;
    for (const key in exp) {
        if (count === filterEntries.length) break;
        let val: unknown;
        try { val = exp[key]; } catch { continue; }
        if (val == null) continue;
        for (const [filterName, filter] of filterEntries) {
            if (filterName in mapped) continue;
            try {
                if (filter(val)) {
                    mapped[filterName] = serialize(val, 1);
                    keys[filterName] = key;
                    count++;
                    break;
                }
            } catch {}
        }
    }

    return { id: factoryId, mapped, keys, unmapped: filterEntries.filter(([n]) => !(n in mapped)).map(([n]) => n) };
}

function actionCss(args: ModuleArgs): unknown {
    const { props } = args;
    if (!props?.length) return err("Provide CSS class names in props.");
    const classes = findCssClasses(...props);
    if (!classes || !Object.keys(classes).length) return err(`No module exports [${props}] as CSS classes`);
    const cssModuleId = findModuleId(classes);
    const result: Result = { id: cssModuleId, classes };
    if (cssModuleId != null) {
        const src = getFactorySource(cssModuleId);
        if (src) result.len = src.length;
    }
    return result;
}

function actionUnloaded(args: ModuleArgs): unknown {
    const cache = getModuleCache();
    const registry = getRuntimeFactoryRegistry();
    if (!registry) return err("No factory registry");
    const sources = getFactorySourceCache();
    const unloaded: number[] = [];
    for (const [fid] of registry) {
        if (!cache.has(fid)) unloaded.push(fid);
    }
    unloaded.sort((a, b) => (sources.get(b)?.length ?? 0) - (sources.get(a)?.length ?? 0));
    const maxPreview = clampConfig(args.limit, MODULE.DEFAULT_UNLOADED_LIMIT, MODULE.MAX_UNLOADED_LIMIT);
    const off = safeOffset(args.offset);
    const previewed = unloaded.slice(off, off + maxPreview).map(uid => {
        const src = sources.get(uid);
        if (!src) return { id: uid };
        return { id: uid, len: src.length, preview: src.slice(0, MODULE.UNLOADED_PREVIEW_LENGTH) };
    });
    return { total: unloaded.length, loaded: cache.size, modules: previewed };
}

function actionWhereUsed(args: ModuleArgs): unknown {
    const check = requireFactorySource(args.id);
    if ("error" in check) return check;
    const importers = whereUsedCacheHolder.get().get(check.id) ?? [];
    const cap = clampConfig(args.limit, MODULE.DEFAULT_WHERE_USED, MODULE.MAX_WHERE_USED);
    const off = safeOffset(args.offset);
    const cache = getModuleCache();
    return { id: check.id, total: importers.length, importers: importers.slice(off, off + cap).map(i => ({ ...i, l: cache.has(i.id) })) };
}

function actionSuggest(args: ModuleArgs): unknown {
    const factory = requireFactorySource(args.id);
    if ("error" in factory) return factory;
    const { src, id } = factory;
    const cap = clampConfig(args.limit, MODULE.DEFAULT_SUGGEST, MODULE.MAX_SUGGEST);
    return { id, len: src.length, candidates: extractSuggestAnchors(src, getAllFactorySources(), cap) };
}

const MODULE_ACTIONS: ActionMap<ModuleArgs> = {
    find: actionFind,
    findBulk: actionFindBulk,
    findComponent: actionFindComponent,
    locate: actionLocate,
    inspect: actionInspect,
    source: actionSource,
    load: actionLoad,
    mapMangled: actionMapMangled,
    css: actionCss,
    unloaded: actionUnloaded,
    whereUsed: actionWhereUsed,
    suggest: actionSuggest,
};

export const handleModule = (args: ModuleArgs): unknown => dispatch(MODULE_ACTIONS, args);
