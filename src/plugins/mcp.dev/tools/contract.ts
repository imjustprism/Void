/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

type Enum = readonly string[];

type Field =
    | { k: "str"; desc?: string; enum?: Enum; def?: string }
    | { k: "num"; desc?: string; def?: number }
    | { k: "bool"; desc?: string; def?: boolean }
    | { k: "strArr"; desc?: string }
    | { k: "strOrArr"; desc?: string }
    | { k: "anyArr"; desc?: string }
    | { k: "strNum"; desc?: string }
    | { k: "obj"; desc?: string }
    | { k: "objArr"; desc?: string; of?: Record<string, Field> }
    | { k: "any"; desc?: string };

interface ToolSpec {
    desc: string;
    required: readonly string[];
    params: Record<string, Field>;
}

type InferField<F> =
    F extends { k: "str"; enum: infer E extends Enum } ? E[number]
        : F extends { k: "str" } ? string
            : F extends { k: "num" } ? number
                : F extends { k: "bool" } ? boolean
                    : F extends { k: "strArr" } ? string[]
                        : F extends { k: "strOrArr" } ? string | string[]
                            : F extends { k: "anyArr" } ? unknown[]
                                : F extends { k: "strNum" } ? string | number
                                : F extends { k: "obj" } ? Record<string, unknown>
                                    : F extends { k: "objArr"; of: infer O } ? { [K in keyof O]?: InferField<O[K]> }[]
                                        : F extends { k: "objArr" } ? Record<string, unknown>[]
                                            : unknown;

type InferArgs<S extends ToolSpec> =
    { [K in S["required"][number] & keyof S["params"]]: InferField<S["params"][K]> }
    & { [K in Exclude<keyof S["params"], S["required"][number]>]?: InferField<S["params"][K]> };

const str = (desc?: string, def?: string) => ({ k: "str", desc, def }) as const;
const enumStr = <const E extends Enum>(values: E, desc?: string, def?: E[number]) => ({ k: "str", enum: values, desc, def }) as const;
const num = (desc?: string, def?: number) => ({ k: "num", desc, def }) as const;
const bool = (desc?: string, def?: boolean) => ({ k: "bool", desc, def }) as const;
const strArr = (desc?: string) => ({ k: "strArr", desc }) as const;
const strOrArr = (desc?: string) => ({ k: "strOrArr", desc }) as const;
const anyArr = (desc?: string) => ({ k: "anyArr", desc }) as const;
const strNum = (desc?: string) => ({ k: "strNum", desc }) as const;
const obj = (desc?: string) => ({ k: "obj", desc }) as const;
const objArr = <const O extends Record<string, Field>>(of: O, desc?: string) => ({ k: "objArr", of, desc }) as const;
const anyVal = (desc?: string) => ({ k: "any", desc }) as const;

const FILTER_FIELDS = {
    props: strArr(),
    code: strArr(),
    displayName: str(),
    storeName: str(),
    componentByCode: bool(),
} as const;

export const TOOLS = {
    module: {
        desc: "Turbopack module operations. find: by props/code/displayName/storeName (limit>1 returns array). findBulk: multi-filter batch. findComponent: by name or code. locate: module id (loaded or not) by factory source code. inspect: facet=exports(keys+types)/imports(deps)/named(named exports)/stats(counts). source: mode=full(factory code)/diff(patched vs original)/function(extract fn body at pattern). load: instantiate by id, or chunks:true to load chunk-loading factory by code. mapMangled: map obfuscated keys. css: class modules. unloaded: not-yet-loaded. whereUsed: reverse deps. suggest: patch anchors.",
        required: ["action"],
        params: {
            action: enumStr(["find", "findBulk", "findComponent", "locate", "inspect", "source", "load", "mapMangled", "css", "unloaded", "whereUsed", "suggest"] as const),
            props: strArr("Export prop names."),
            code: strArr("find: exported fn source. locate/mapMangled/load(chunks): factory source."),
            displayName: str(),
            storeName: str("Short name OK, e.g. 'chat' → useChatPageStore."),
            componentByCode: bool(),
            id: num(),
            offset: num(undefined, 0),
            limit: num("find: >1 returns array of matches."),
            patched: bool(undefined, false),
            search: str("Jump to string in source, overrides offset."),
            async: bool(undefined, false),
            mappers: obj("Map of {name: filterType}. Types: fn/string/number/boolean/object/array/component/hasProps:a,b/code:x."),
            pattern: str("Locate in source (source mode:function)."),
            filters: objArr(FILTER_FIELDS, "For findBulk: 2+ filters."),
            facet: enumStr(["exports", "imports", "named", "stats"] as const, "inspect: which facet to return.", "exports"),
            mode: enumStr(["full", "diff", "function"] as const, "source: full code, patched diff, or extracted function.", "full"),
            chunks: bool("load: load the chunk-loading factory matched by code.", false),
        },
    },
    search: {
        desc: "Search factory source across all modules. Plain text or /regex/flags. With id: all matches in one module. Use this for factory code — module find+code only checks exported fn toString(). filter: loaded/unloaded/patched.",
        required: [],
        params: {
            pattern: str(),
            and: strArr("All must match the same module."),
            id: num("Single module."),
            max: num(undefined, 10),
            context: num(undefined, 50),
            filter: enumStr(["loaded", "unloaded", "patched"] as const),
            count: bool(undefined, false),
            decode: bool("Scan for base64/hex string literals and return the ones that decode to printable text (hidden URLs, configs). Ignores pattern.", false),
        },
    },
    evaluateCode: {
        desc: "Run JS in page context. Has window.Void, DOM. Supports await/import(). Auto-returns last expression.",
        required: ["code"],
        params: {
            code: str("Max 10000 chars."),
        },
    },
    patch: {
        desc: "Patch ops. test: validate find+match+replace. analyze: find uniqueness. list: all patches+status. conflicts: multi-plugin modules. broken: failed patches. lint: regex quality. context: source neighborhood+anchors. bench: regex speed. report: full summary. validate: reporter-style audit flagging find::no-module, find::ambiguous, replace::match-miss, replace::backref-invalid, replace::regex-invalid, replace::syntax-error, group::failed. Use plugin to scope, severity to filter.",
        required: ["action"],
        params: {
            action: enumStr(["test", "analyze", "list", "conflicts", "broken", "lint", "context", "bench", "report", "validate"] as const),
            find: strOrArr("Module locator string or array of strings."),
            match: str("Regex as plain string. \\i=minified var, .{0,N}=bounded gap."),
            replace: str("Supports $1, $&, $self."),
            flags: str(),
            window: num(undefined, 1200),
            context: num(undefined, 120),
            plugin: str("validate: restrict audit to one plugin."),
            severity: enumStr(["error", "warn", "all"] as const, "validate: filter issues by severity.", "error"),
        },
    },
    plugin: {
        desc: "Plugin management. list/enable/disable/toggle/settings/setSetting.",
        required: ["action"],
        params: {
            action: enumStr(["list", "enable", "disable", "toggle", "settings", "setSetting"] as const),
            name: str(),
            key: str(),
            value: anyVal(),
        },
    },
    react: {
        desc: "React/DOM inspector. find: components by name. root: all components. query: CSS selector→elements+rects. fiber: walk up. props/hooks/state: component internals. tree: DOM subtree. owner: debug owner chain.",
        required: ["action"],
        params: {
            action: enumStr(["find", "root", "query", "fiber", "props", "hooks", "state", "tree", "owner"] as const),
            selector: str(),
            componentName: str(),
            depth: num(undefined, 10),
            limit: num(undefined, 10),
            includeProps: bool(undefined, false),
            breadth: num(undefined, 5),
        },
    },
    store: {
        desc: "Zustand store inspector. list/get/keys/methods/call/subscribe. Query by name (partial match, shows alternatives) or module ID. call returns stateChanged diff.",
        required: ["action"],
        params: {
            action: enumStr(["list", "get", "keys", "methods", "call", "subscribe"] as const),
            query: strNum(),
            path: str("Dot path into state."),
            depth: num(undefined, 2),
            method: str(),
            callArgs: anyArr(),
            duration: num(undefined, 10000),
            maxCaptures: num(undefined, 30),
        },
    },
    intercept: {
        desc: "Intercept function calls on module exports. set: start capturing (only configurable properties). get: read captures. stop: restore original and return last captures. stopAll: clear all. list: active. exportKey supports nested paths like 'default.fn'. Auto-expires after duration (default 30s, max 120s). maxCaptures limits stored calls (default 30, max 200).",
        required: ["action"],
        params: {
            action: enumStr(["set", "get", "stop", "stopAll", "list"] as const),
            moduleId: num(),
            exportKey: str(undefined, "default"),
            id: num(),
            duration: num(undefined, 30000),
            maxCaptures: num(undefined, 30),
        },
    },
    grok: {
        desc: "Chat with Grok AI via native UI. send: type message and submit through Grok's chat input (real-time, visible in UI). read: load response/conversation history. models: list available models with rate limits.",
        required: ["action"],
        params: {
            action: enumStr(["send", "read", "models"] as const),
            message: str("Message to send (send action)."),
            model: str("Model ID e.g. grok-3, grok-4. Default: current active model."),
            conversationId: str("Existing conversation ID. Navigates to it before sending."),
            responseId: str("Response ID to read (read action)."),
            reasoningMode: enumStr(["none", "think", "deepsearch"] as const, undefined, "none"),
        },
    },
} as const satisfies Record<string, ToolSpec>;

export type ToolName = keyof typeof TOOLS;

export type ToolArgsMap = { [K in ToolName]: InferArgs<typeof TOOLS[K]> };

interface JsonSchemaProp {
    type?: string | string[];
    enum?: readonly string[];
    default?: unknown;
    description?: string;
    items?: unknown;
    properties?: Record<string, unknown>;
    oneOf?: unknown[];
}

function fieldToSchema(f: Field): JsonSchemaProp {
    const base: JsonSchemaProp = {};
    if (f.desc) base.description = f.desc;
    switch (f.k) {
        case "str": {
            base.type = "string";
            if (f.enum) base.enum = f.enum;
            break;
        }
        case "num": base.type = "number"; break;
        case "bool": base.type = "boolean"; break;
        case "strArr": base.type = "array"; base.items = { type: "string" }; break;
        case "strOrArr": return { ...base, oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } as JsonSchemaProp;
        case "anyArr": base.type = "array"; break;
        case "strNum": base.type = ["string", "number"]; break;
        case "obj": base.type = "object"; break;
        case "objArr":
            base.type = "array";
            base.items = f.of
                ? { type: "object", properties: Object.fromEntries(Object.entries(f.of).map(([k, v]) => [k, fieldToSchema(v)])) }
                : { type: "object" };
            break;
        case "any": break;
    }
    if ("def" in f && f.def !== undefined) base.default = f.def;
    return base;
}

export const TOOL_DEFINITIONS = Object.entries(TOOLS).map(([name, spec]) => ({
    name,
    description: spec.desc,
    inputSchema: {
        type: "object",
        properties: Object.fromEntries(Object.entries(spec.params).map(([k, f]) => [k, fieldToSchema(f)])),
        required: spec.required,
    },
}));
