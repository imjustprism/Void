/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, plugins, startPlugin, stopPlugin } from "@api/PluginManager";
import { mergePluginSettings, Settings } from "@api/Settings";
import { OptionType, type Plugin } from "@utils/types";

import type { PluginArgs, PluginInfo } from "./types";
import { type ActionMap, dispatch, notFound } from "./utils";

const TYPE_MAP: Partial<Record<number, string>> = {
    [OptionType.BOOLEAN]: "boolean",
    [OptionType.STRING]: "string",
    [OptionType.NUMBER]: "number",
    [OptionType.SLIDER]: "number",
    [OptionType.BIGINT]: "bigint",
};

interface Resolved {
    plugin: Plugin;
    name: string;
}

function resolve(name: string | undefined): Resolved | { error: string; similar?: string[] } {
    if (!name) return { error: "Provide plugin name." };
    const exact = plugins[name] ? name : Object.keys(plugins).find(n => n.toLowerCase() === name.toLowerCase());
    if (!exact) return notFound("Plugin", name, Object.keys(plugins));
    return { plugin: plugins[exact], name: exact };
}

const withPlugin = (fn: (p: Resolved, args: PluginArgs) => unknown) => (args: PluginArgs): unknown => {
    const r = resolve(args.name);
    return "error" in r ? r : fn(r, args);
};

function actionList(): PluginInfo[] {
    return Object.values(plugins).map((p): PluginInfo => {
        const info: PluginInfo = { name: p.name, enabled: isPluginEnabled(p.name), started: p.started };
        if (p.required) info.required = true;
        if (p.description) info.desc = p.description;
        return info;
    });
}

function setEnabled({ plugin, name }: Resolved, enabling: boolean): unknown {
    if (!enabling) {
        if (plugin.required) return { error: `Cannot disable required plugin: ${name}` };
        if (name === "MCP") return { error: "Cannot disable MCP plugin via MCP, would kill this connection." };
    }
    const noop = enabling === isPluginEnabled(name);
    mergePluginSettings(name, { enabled: enabling });
    if (!noop) (enabling ? startPlugin : stopPlugin)(plugin);
    return { ok: true, action: enabling ? "enabled" : "disabled", name, ...(noop && { noop: true }) };
}

function validateSetting(plugin: Plugin, name: string, key: string, value: unknown): { error: string } | null {
    const def = plugin.settings?.def?.[key];
    if (!def) {
        const valid = plugin.settings?.def;
        return valid && !(key in valid)
            ? { error: `Unknown setting key "${key}" for ${name}. Valid keys: ${Object.keys(valid).join(", ")}` }
            : null;
    }
    const expectedType = TYPE_MAP[def.type];
    if (expectedType && typeof value !== expectedType) return { error: `Setting "${key}" expects ${expectedType}, got ${typeof value}.` };
    if (def.type === OptionType.SELECT && !def.options.some(o => o.value === value))
        return { error: `Invalid value for "${key}". Valid options: ${def.options.map(o => JSON.stringify(o.value)).join(", ")}` };
    if (def.type === OptionType.SLIDER && typeof value === "number" && (value < def.min || value > def.max))
        return { error: `Value ${value} out of range for "${key}" (min: ${def.min}, max: ${def.max}).` };
    return null;
}

const actionSetSetting = withPlugin(({ plugin, name }, { key, value }) => {
    if (!key) return { error: "Provide setting key. Use settings action to see available keys." };
    const invalid = validateSetting(plugin, name, key, value);
    if (invalid) return invalid;
    mergePluginSettings(name, { [key]: value });
    return { ok: true, name, key, value };
});

const PLUGIN_ACTIONS: ActionMap<PluginArgs> = {
    list: actionList,
    enable: withPlugin(p => setEnabled(p, true)),
    disable: withPlugin(p => setEnabled(p, false)),
    toggle: withPlugin(p => setEnabled(p, !isPluginEnabled(p.name))),
    settings: withPlugin(({ name }) => Settings.plugins[name] ?? {}),
    setSetting: actionSetSetting,
};

export const handlePlugin = (args: PluginArgs): unknown => dispatch(PLUGIN_ACTIONS, args);
