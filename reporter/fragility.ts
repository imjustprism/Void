/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PatchSpec } from "./extract";
import type { Diagnostic } from "./fmt";

export type FragilityCode =
    | "fragile::exact-count"
    | "fragile::css-anchor"
    | "fragile::no-anchor";

const EXACT_COUNT_RE = /(?:\\i[,)]){3,}/;
const BOUNDED_COUNT_RE = /\{\d*,\d+\}/;
const STRING_LITERAL_RE = /"(?:[^"\\]|\\.){3,}"|'(?:[^'\\]|\\.){3,}'/;
const BOUNDED_GAP_RE = /\.\{0,\d+\}|\[\^[^\]]+\]\{0,\d+\}/;
const CSS_TOKEN_RE = /(?:^|[\s"])(?:flex|grid|hidden|inline-flex|absolute|relative|truncate|w-|h-|min-|max-|p[xytblrse]?-|m[xytblrse]?-|gap-|space-|text-|bg-|border|rounded|items-|justify-|self-|font-|leading-|tracking-|shadow|opacity|z-|overflow|cursor-|select-|ring-|outline|transition|duration-|ease-|scale-|rotate-|translate-|aspect-|inset-|top-|bottom-|left-|right-)/g;
const LONG_MATCH = 80;

function looksLikeCss(s: string): boolean {
    if (!s.includes(" ")) return false;
    const m = s.match(CSS_TOKEN_RE);
    return !!m && m.length >= 2;
}

export function analyzeFragility(patch: PatchSpec): Diagnostic[] {
    if (patch.noWarn) return [];
    const out: Diagnostic[] = [];

    for (const f of patch.find) {
        if (f.kind === "string" && looksLikeCss(f.value)) {
            out.push({
                severity: "warn",
                code: "fragile::css-anchor",
                title: `${patch.plugin}: find anchored on CSS classes`,
                primary: { span: f.span, label: "Tailwind classes change between builds" },
                help: "Anchor on an i18n key, data-testid, analytics event, or other stable string literal instead.",
            });
        }
    }

    for (const rep of patch.replacement) {
        if (rep.noWarn || rep.match.kind !== "regex") continue;
        const src = rep.match.value;

        if (EXACT_COUNT_RE.test(src) && !BOUNDED_COUNT_RE.test(src)) {
            out.push({
                severity: "warn",
                code: "fragile::exact-count",
                title: `${patch.plugin}: match counts an exact number of siblings`,
                primary: { span: rep.match.span, label: "`\\i,\\i,\\i` breaks when Grok adds or removes an element" },
                help: "Use a bounded quantifier like `(?:\\i,){2,8}\\i` instead of a fixed run.",
            });
        }

        if (looksLikeCss(src)) {
            out.push({
                severity: "warn",
                code: "fragile::css-anchor",
                title: `${patch.plugin}: match anchored on CSS classes`,
                primary: { span: rep.match.span, label: "Tailwind classes change between builds" },
                help: "Anchor on a stable string literal near the target instead of class names.",
            });
        } else if (src.length >= LONG_MATCH && !STRING_LITERAL_RE.test(src) && !BOUNDED_GAP_RE.test(src)) {
            out.push({
                severity: "warn",
                code: "fragile::no-anchor",
                title: `${patch.plugin}: long rigid match with no string anchor or bounded gap`,
                primary: { span: rep.match.span, label: `${src.length} chars of fixed minified shape — no literal, no \`.{0,N}\` flex` },
                help: "Add a string literal anchor, or insert bounded `.{0,N}?` gaps so the match absorbs prop-insertion drift.",
            });
        }
    }

    return out;
}
