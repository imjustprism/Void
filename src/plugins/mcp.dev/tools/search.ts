/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getModuleCache } from "@turbopack/patchTurbopack";
import { matchesAllPatterns } from "@turbopack/turbopack";

import { SEARCH } from "./constants";
import type { SearchArgs, SearchMatch } from "./types";
import { clampConfig, getFactorySourceCache, isModulePatched, parseRegexPattern } from "./utils";

type Filter = SearchArgs["filter"];

interface SearchContext {
    sources: Map<number, string>;
    loadedCache: Map<number, unknown> | null;
    filter: Filter;
    targetId: number | undefined;
    max: number;
    context: number;
}

interface SearchResult {
    matches: SearchMatch[];
    totalModules?: number;
    hint?: string;
}

interface Hit {
    idx: number;
    len: number;
}

function findMatch(src: string, pattern: string, regex: RegExp | null, startFrom = 0): Hit | null {
    if (regex) {
        regex.lastIndex = startFrom;
        const m = regex.exec(src);
        return m ? { idx: m.index, len: m[0].length } : null;
    }
    const idx = src.indexOf(pattern, startFrom);
    return idx === -1 ? null : { idx, len: pattern.length };
}

function buildMatchEntry(id: number, src: string, idx: number, matchLen: number, ctx: number): SearchMatch {
    const cappedLen = Math.min(matchLen, SEARCH.MAX_MATCH_LENGTH);
    const start = Math.max(0, idx - ctx);
    const end = Math.min(src.length, idx + cappedLen + ctx);
    const entry: SearchMatch = { id, at: idx, s: src.slice(start, end), len: src.length };
    if (matchLen > SEARCH.MAX_MATCH_LENGTH) entry.truncatedMatch = true;
    if (isModulePatched(id)) entry.patched = true;
    return entry;
}

function shouldSkip(id: number, ctx: SearchContext): boolean {
    if (ctx.targetId != null && id !== ctx.targetId) return true;
    if (!ctx.filter) return false;
    if (ctx.filter === "patched") return !isModulePatched(id);
    if (!ctx.loadedCache) return false;
    if (ctx.filter === "loaded") return !ctx.loadedCache.has(id);
    if (ctx.filter === "unloaded") return ctx.loadedCache.has(id);
    return false;
}

function countModules(ctx: SearchContext, test: (src: string) => boolean): number {
    let hits = 0;
    for (const [id, src] of ctx.sources) {
        if (!shouldSkip(id, ctx) && test(src)) hits++;
    }
    return hits;
}

function searchMultiPattern(ctx: SearchContext, rawPatterns: string[], patterns: (string | RegExp)[]): SearchResult {
    const matches: SearchMatch[] = [];
    const first = patterns[0];
    const firstStr = typeof first === "string" ? first : "";
    const firstRe = typeof first === "string" ? null : first;
    let moduleHits = 0;

    for (const [id, src] of ctx.sources) {
        if (shouldSkip(id, ctx) || !matchesAllPatterns(src, patterns)) continue;
        moduleHits++;
        if (matches.length >= ctx.max) continue;
        const hit = findMatch(src, firstStr, firstRe);
        matches.push(buildMatchEntry(id, src, hit?.idx ?? 0, hit?.len ?? 0, ctx.context));
    }

    const result: SearchResult = { matches };
    if (moduleHits > matches.length) result.totalModules = moduleHits;
    if (!matches.length && !moduleHits) result.hint = multiPatternHint(ctx, rawPatterns);
    return result;
}

function multiPatternHint(ctx: SearchContext, rawPatterns: string[]): string {
    const hints = [`No modules matched all ${rawPatterns.length} patterns. Try fewer constraints.`];
    for (const raw of rawPatterns) {
        const { regex } = parseRegexPattern(raw);
        const count = countModules(ctx, src => (regex ? findMatch(src, "", regex) !== null : src.includes(raw)));
        if (!count) hints.push(`Pattern '${raw}' had 0 matches individually.`);
    }
    if (ctx.filter) hints.push("Try without filter.");
    return hints.join(" ");
}

function searchSinglePattern(ctx: SearchContext, pattern: string, regex: RegExp | null): SearchResult {
    const matches: SearchMatch[] = [];
    let total = 0;
    let moduleHits = 0;
    let capped = false;

    for (const [id, src] of ctx.sources) {
        if (shouldSkip(id, ctx)) continue;

        if (ctx.targetId != null) {
            let startFrom = 0;
            while (matches.length < ctx.max && total < SEARCH.MAX_TOTAL) {
                const hit = findMatch(src, pattern, regex, startFrom);
                if (!hit) break;
                const entry = buildMatchEntry(id, src, hit.idx, hit.len, ctx.context);
                total += entry.s.length;
                matches.push(entry);
                startFrom = hit.idx + Math.max(hit.len, 1);
            }
            continue;
        }

        const hit = findMatch(src, pattern, regex);
        if (!hit) continue;
        moduleHits++;
        if (capped) continue;
        if (matches.length >= ctx.max || total >= SEARCH.MAX_TOTAL) { capped = true; continue; }
        const entry = buildMatchEntry(id, src, hit.idx, hit.len, ctx.context);
        total += entry.s.length;
        matches.push(entry);
    }

    const result: SearchResult = { matches };
    if (ctx.targetId == null && moduleHits > matches.length) result.totalModules = moduleHits;
    if (!matches.length && !moduleHits) result.hint = noMatchHint(ctx, pattern, regex);
    if (total >= SEARCH.MAX_TOTAL) result.hint = `${result.hint ? `${result.hint} ` : ""}Stopped early due to output size limit.`;
    return result;
}

function noMatchHint(ctx: SearchContext, pattern: string, regex: RegExp | null): string {
    if (ctx.filter)
        return `No matches with filter "${ctx.filter}". Try without filter or check if pattern exists in ${ctx.filter === "loaded" ? "unloaded" : "loaded"} modules.`;
    if (ctx.targetId != null) return `Pattern not found in module ${ctx.targetId}. Use without id to search all modules.`;
    if (regex) return "No regex matches. Check syntax or try a simpler literal pattern.";
    return `Literal "${pattern.slice(0, 40)}" not found in any factory source. Check spelling or try a partial/regex pattern.`;
}

const ENCODED_RE = /["'`]([A-Za-z0-9+/]{24,}={0,2})["'`]/g;
const PRINTABLE_RE = /^[\x20-\x7e]{8,}$/;
const STRUCTURED_RE = /[.:/@]/;
const HEX_RE = /^[0-9a-f]+$/;

function decodePrintable(raw: string): string | null {
    if (raw.length % 4 === 0) {
        try {
            const d = atob(raw);
            if (PRINTABLE_RE.test(d) && STRUCTURED_RE.test(d)) return d;
        } catch {}
    }
    if (raw.length % 2 === 0 && HEX_RE.test(raw)) {
        let d = "";
        for (let i = 0; i < raw.length; i += 2) d += String.fromCharCode(parseInt(raw.slice(i, i + 2), 16));
        if (PRINTABLE_RE.test(d) && STRUCTURED_RE.test(d)) return d;
    }
    return null;
}

function decodeScan(ctx: SearchContext, max: number): unknown {
    const seen = new Set<string>();
    const found: Array<{ id: number; encoded: string; decoded: string }> = [];
    let scanned = 0;
    for (const [id, src] of ctx.sources) {
        if (shouldSkip(id, ctx)) continue;
        scanned++;
        ENCODED_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = ENCODED_RE.exec(src)) !== null) {
            const decoded = decodePrintable(m[1]);
            if (decoded == null || seen.has(decoded)) continue;
            seen.add(decoded);
            found.push({ id, encoded: m[1].slice(0, 32), decoded: decoded.slice(0, 200) });
            if (found.length >= max) return { decoded: found, scanned, capped: true };
        }
    }
    return { decoded: found, scanned, total: found.length };
}

export function handleSearch(args: SearchArgs): unknown {
    const { pattern, id: targetId, and: andPatterns, filter } = args;
    const max = clampConfig(args.max, { default: SEARCH.DEFAULT_MAX, max: SEARCH.MAX_RESULTS_CAP });
    const context = clampConfig(args.context, { default: SEARCH.DEFAULT_CONTEXT, max: SEARCH.MAX_CONTEXT });

    if (filter && filter !== "loaded" && filter !== "unloaded" && filter !== "patched")
        return { error: `Invalid filter: "${filter}". Use "loaded", "unloaded", or "patched".` };

    const sources = getFactorySourceCache();
    if (!sources.size) return { error: "Factory registry not available" };

    if (args.decode) {
        const ctx: SearchContext = { sources, loadedCache: filter ? getModuleCache() : null, filter, targetId, max, context };
        return decodeScan(ctx, clampConfig(args.max, { default: 20, max: SEARCH.MAX_RESULTS_CAP }));
    }

    if (!pattern && !andPatterns?.length)
        return { error: 'Provide pattern (string or /regex/) or and[] (array of strings). Use count:true for count-only, filter:"loaded"/"unloaded" to narrow scope.' };

    const ctx: SearchContext = {
        sources,
        loadedCache: filter ? getModuleCache() : null,
        filter,
        targetId,
        max,
        context,
    };

    if (andPatterns?.length) {
        const rawPatterns = pattern ? [pattern, ...andPatterns] : andPatterns;
        const patterns: (string | RegExp)[] = rawPatterns.map(p => parseRegexPattern(p).regex ?? p);
        if (args.count) return { count: countModules(ctx, src => matchesAllPatterns(src, patterns)), total: sources.size };
        return searchMultiPattern(ctx, rawPatterns, patterns);
    }

    if (!pattern) return { error: "Pattern must not be empty." };
    const { regex } = parseRegexPattern(pattern);
    if (!regex && pattern.startsWith("/")) return { error: `Invalid regex: could not parse ${pattern}. Use /pattern/flags syntax.` };

    if (args.count) return { count: countModules(ctx, src => findMatch(src, pattern, regex) !== null), total: sources.size };
    return searchSinglePattern(ctx, pattern, regex);
}
