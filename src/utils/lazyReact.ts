/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { makeLazy } from "@utils/lazy";
import type { ComponentType } from "react";

export type AnyComponent = ComponentType & Record<string, any>;

type CreateElementFn = (type: any, props?: any, ...children: any[]) => any;

let _createElement: CreateElementFn | null = null;

export function setCreateElement(fn: CreateElementFn) {
    _createElement = fn;
}

const LAZY_MAX_RETRIES = 200;

export function LazyComponent<T extends AnyComponent = AnyComponent>(name: string, factory: () => T | null): T {
    const resolve = makeLazy(factory, LAZY_MAX_RETRIES, name);

    const wrapper = ((props: Record<string, any>) => {
        const cached = resolve();
        if (!cached || !_createElement) return null;
        return _createElement(cached, props);
    }) as unknown as T;

    Object.defineProperty(wrapper, "name", { value: name });

    return new Proxy(wrapper, {
        get(target, prop, receiver) {
            const cached = resolve();
            if (cached && Reflect.has(cached as object, prop)) return Reflect.get(cached as object, prop);
            return Reflect.get(target, prop, receiver);
        },
    }) as T;
}
