/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "fs";

import { chunkStats, type ChunkMap, loadChunkMap } from "./chunks";
import { collectAllFinders, collectAllPatches } from "./extract";
import { summariseFinders, testFinder } from "./finders";
import { ansi, counter, type Diagnostic, renderDiagnostic } from "./fmt";
import { analyzeFragility } from "./fragility";
import { summariseTimings, testPatch } from "./patches";

const GROK_URL = "https://grok.com";
const BAR_WIDTH = 20;

const PHASE_TITLES: Record<string, string> = {
    html: "Fetching grok.com",
    manifests: "Fetching build manifests",
    crawl: "Crawling lazy chunks",
    parse: "Parsing modules",
};

function formatDuration(ms: number): string {
    return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function bar(cur: number, total: number): string {
    if (!total) return ansi.dim("─".repeat(BAR_WIDTH));
    const filled = Math.min(BAR_WIDTH, Math.round((cur / total) * BAR_WIDTH));
    return ansi.cyan("█".repeat(filled)) + ansi.dim("░".repeat(BAR_WIDTH - filled));
}

function phaseTitle(name: string): string {
    return PHASE_TITLES[name] ?? name;
}

async function runPhases(origin: string): Promise<ChunkMap> {
    const tty = process.stdout.isTTY;
    const clearLine = "\r\x1b[2K";
    let current: { label: string; start: number; detail?: string } | null = null;

    const finishCurrent = (): void => {
        if (!current) return;
        const dur = formatDuration(performance.now() - current.start);
        if (tty) process.stdout.write(clearLine);
        process.stdout.write(`  ${ansi.green("✓")} ${phaseTitle(current.label).padEnd(28)} ${ansi.dim(dur.padStart(6))}${current.detail ? "  " + ansi.dim(current.detail) : ""}\n`);
    };

    const onPhase = (name: string, currentCount?: number, total?: number): void => {
        if (current?.label !== name) {
            finishCurrent();
            current = { label: name, start: performance.now() };
            if (!tty) process.stdout.write(`  ${ansi.dim("›")} ${phaseTitle(name)}\n`);
        }
        if (currentCount != null && total != null) {
            current.detail = `${currentCount}/${total}`;
            if (tty) process.stdout.write(`${clearLine}  ${ansi.dim("›")} ${phaseTitle(name)} ${bar(currentCount, total)} ${ansi.dim(current.detail)}`);
        }
    };

    const t0 = performance.now();
    const map = await loadChunkMap(origin, onPhase);
    finishCurrent();
    console.log(ansi.dim(`  ${formatDuration(performance.now() - t0)} total, ${map.chunks.size} chunks, ${map.modules.size} modules`));
    return map;
}

export async function run(): Promise<void> {
    console.log(ansi.bold("\nVoid Reporter"));
    console.log(ansi.dim(`  target: ${GROK_URL}`));

    const map = await runPhases(GROK_URL);
    const stats = chunkStats(map);

    console.log(ansi.bold("\nBuild"));
    console.log(`  buildId: ${ansi.cyan(map.buildId)}`);
    console.log(`  chunks: ${stats.chunks}  modules: ${stats.modules}  bytes: ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);

    const sriCount = (map.html.match(/integrity="sha/g) ?? []).length;
    if (sriCount) console.log(`  ${ansi.yellow("SRI enforced")} on ${sriCount} script tag(s), runtime patching may break`);

    console.log(ansi.bold("\nPatches"));
    const patches = collectAllPatches();
    const patchEntries = patches.map(p => testPatch(p, map));
    const fileCache = loadFileCache(patches);
    const patchDiags: Diagnostic[] = [];
    let patchPass = 0, patchFail = 0, patchWarn = 0;
    for (const e of patchEntries) {
        const fatal = e.diagnostics.some(d => d.severity === "error");
        if (fatal) patchFail++; else patchPass++;
        if (e.diagnostics.some(d => d.severity === "warn") && !fatal) patchWarn++;
        patchDiags.push(...e.diagnostics);
    }
    console.log(`  ${counter("total", patchPass, patchFail, patchWarn ? ansi.yellow(`${patchWarn} warn`) : undefined)}`);

    console.log(ansi.bold("\nFinders"));
    const finders = collectAllFinders();
    const finderEntries = finders.map(f => testFinder(f, map));
    const finderDiags: Diagnostic[] = [];
    let finderPass = 0, finderFail = 0;
    for (const e of finderEntries) {
        if (e.ok) finderPass++; else finderFail++;
        finderDiags.push(...e.diagnostics);
    }
    console.log(`  ${counter("total", finderPass, finderFail)}`);
    for (const [kind, v] of Object.entries(summariseFinders(finderEntries).byKind).sort(([a], [b]) => a.localeCompare(b))) {
        const flag = v.failed ? ansi.red(`-${v.failed}`) : ansi.dim("ok");
        console.log(`  ${ansi.dim(kind.padEnd(22))} ${String(v.total).padStart(4)}  ${flag}`);
    }

    const fragile = patches.flatMap(p => analyzeFragility(p));
    console.log(ansi.bold("\nFragility"));
    if (!fragile.length) {
        console.log(ansi.dim("  no fragile patterns"));
    } else {
        console.log(`  ${ansi.yellow(String(fragile.length))} pattern(s) match now but are likely to break on a future Grok build:`);
        for (const d of fragile) console.log(renderDiagnostic(d, fileCache));
    }

    const allDiags = [...patchDiags, ...finderDiags];
    if (allDiags.length) {
        console.log(ansi.bold("\nDiagnostics"));
        for (const d of allDiags) if (d.severity !== "info") console.log(renderDiagnostic(d, fileCache));
    }

    const slow = summariseTimings(patchEntries);
    if (slow.length) {
        console.log(ansi.bold("\nSlow replacements (>20ms)"));
        for (const s of slow.slice(0, 10)) {
            console.log(`  ${ansi.yellow(formatDuration(s.timeMs).padStart(7))}  ${ansi.bold(s.patch.plugin)}  ${ansi.dim(String(s.patch.find[0]?.raw ?? "").slice(0, 60))}`);
        }
    }

    let rscCount = 0;
    for (const mod of map.modules.values()) {
        const hits = mod.factory.match(/createServerReference\(/g);
        if (hits) rscCount += hits.length;
    }
    console.log(ansi.bold("\nRSC"));
    console.log(`  ${ansi.dim(`${rscCount} server reference(s)`)}`);

    const errors = allDiags.filter(d => d.severity === "error").length;
    const warns = allDiags.filter(d => d.severity === "warn").length;
    console.log(ansi.bold("\nSummary"));
    console.log(`  ${errors ? ansi.red(`${errors} error(s)`) : ansi.green("0 errors")}  ${warns ? ansi.yellow(`${warns} warning(s)`) : ansi.dim("0 warnings")}\n`);

    process.exitCode = errors ? 1 : 0;
}

function loadFileCache(patches: Array<{ file: string }>): Map<string, string> {
    const cache = new Map<string, string>();
    for (const p of patches) {
        if (cache.has(p.file)) continue;
        try { cache.set(p.file, readFileSync(p.file, "utf-8")); }
        catch { continue; }
    }
    return cache;
}
