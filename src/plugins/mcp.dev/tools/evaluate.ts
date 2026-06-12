/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EVAL } from "./constants";
import type { EvalArgs } from "./types";
import { formatError, isThenable, serialize } from "./utils";

const STATEMENT_RE = /^(return|throw|break|continue|if|for|while|switch|try|class|function(?!\s*\()|const|let|var)\b/;
const IIFE_TRIGGER_RE = /^(?:return\s|let\s|const\s|var\s|class\s)/;

function stripTrailingComment(line: string): string {
    let inStr: string | null = null;
    let commentStart = -1;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "\\" && inStr) { i++; continue; }
        if (inStr) { if (ch === inStr) inStr = null; continue; }
        if (ch === "\"" || ch === "'" || ch === "`") { inStr = ch; continue; }
        if (ch === "/" && line[i + 1] === "/") { commentStart = i; break; }
        if (ch === "/" && line[i + 1] === "*") {
            const end = line.indexOf("*/", i + 2);
            if (end !== -1 && end === line.length - 2) { commentStart = i; break; }
            if (end !== -1) { i = end + 1; continue; }
        }
    }
    return (commentStart >= 0 ? line.slice(0, commentStart) : line).trim();
}

function findLastTopLevelSemicolon(src: string): number {
    let depth = 0;
    for (let i = src.length - 1; i >= 0; i--) {
        const ch = src[i];
        if (ch === "\"" || ch === "'" || ch === "`") {
            while (--i >= 0 && !(src[i] === ch && src[i - 1] !== "\\"));
            continue;
        }
        if (ch === ")") depth++;
        else if (ch === "(") depth--;
        else if (ch === ";" && depth <= 0) return i;
    }
    return -1;
}

function autoReturn(code: string): string {
    const trimmed = code.replace(/\s+$/, "");
    const lastNewline = trimmed.lastIndexOf("\n");
    const lastLine = (lastNewline === -1 ? trimmed : trimmed.slice(lastNewline + 1)).trim();

    if (!lastLine || /^[)\]},;]+$/.test(lastLine) || lastLine.startsWith("//") || lastLine.startsWith("/*")) return code;

    const expr = stripTrailingComment(lastLine).replace(/;$/, "").trim();
    if (!expr) return code;

    if (STATEMENT_RE.test(expr)) {
        const semi = findLastTopLevelSemicolon(trimmed);
        if (semi > -1 && semi < trimmed.length - 1) {
            const tail = stripTrailingComment(trimmed.slice(semi + 1)).trim();
            if (tail && !STATEMENT_RE.test(tail)) return `${trimmed.slice(0, semi + 1)}\nreturn ${tail};`;
        }
        return trimmed;
    }

    return lastNewline === -1 ? `return ${expr};` : `${trimmed.slice(0, lastNewline)}\nreturn ${expr};`;
}

const wrapIIFE = (code: string): string => `(()=>{${autoReturn(code)}})()`;

// eslint-disable-next-line no-eval
const run = (code: string): unknown => (0, eval)(code);

const resolveThenable = (value: PromiseLike<unknown>): Promise<unknown> =>
    Promise.resolve(value).then(
        val => serialize(val, EVAL.SERIALIZE_DEPTH),
        (err: unknown) => ({ error: formatError(err) }),
    );

const isAsyncSyntaxError = (err: unknown, code: string): boolean =>
    err instanceof SyntaxError && (err.message.includes("await") || code.includes("await ") || code.includes("import("));

export function handleEval(args: EvalArgs): unknown {
    const { code } = args;
    if (!code) return { error: "Provide code to evaluate." };
    if (code.length > EVAL.MAX_CODE_LENGTH)
        return { error: `Code too long: ${code.length} chars (max ${EVAL.MAX_CODE_LENGTH}). Reduce code or split into multiple calls.` };

    const needsIIFE = IIFE_TRIGGER_RE.test(code.trimStart());
    let source = needsIIFE ? wrapIIFE(code) : code;

    let value: unknown;
    try {
        value = run(source);
    } catch (err) {
        if (isAsyncSyntaxError(err, code)) {
            try {
                return resolveThenable(run(`(async()=>{${autoReturn(code)}})()`) as PromiseLike<unknown>);
            } catch (asyncErr) {
                return { error: formatError(asyncErr) };
            }
        }
        if (err instanceof SyntaxError && source === code) {
            try {
                value = run((source = wrapIIFE(code)));
            } catch (retryErr) {
                return { error: formatError(retryErr) };
            }
        } else {
            return { error: formatError(err) };
        }
    }

    return isThenable(value) ? resolveThenable(value) : serialize(value, EVAL.SERIALIZE_DEPTH);
}
