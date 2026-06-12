/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TOOL_DEFINITIONS } from "./contract";
import { handleEval } from "./evaluate";
import { handleGrok } from "./grok";
import { handleIntercept } from "./intercept";
import { handleModule } from "./module";
import { handlePatch } from "./patch";
import { handlePlugin } from "./plugin";
import { handleReact } from "./react";
import { handleSearch } from "./search";
import { handleStore } from "./store";
import type { ToolArgs, ToolArgsMap, ToolHandler, ToolName } from "./types";

export { TOOL_DEFINITIONS };

type TypedHandlers = { [K in ToolName]: (args: ToolArgsMap[K]) => unknown };

const typedHandlers: TypedHandlers = {
    module: handleModule,
    search: handleSearch,
    evaluateCode: handleEval,
    patch: handlePatch,
    plugin: handlePlugin,
    react: handleReact,
    store: handleStore,
    intercept: handleIntercept,
    grok: handleGrok,
};

export const toolHandlers = typedHandlers as unknown as Record<ToolName, ToolHandler>;

export type { ToolArgs, ToolName };
