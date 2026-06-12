/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "./Logger";

const logger = new Logger("Lazy");

const unconfigurable = ["arguments", "caller", "prototype"];

const SYM_LAZY_GET = Symbol.for("void.lazy.get");
const SYM_LAZY_CACHED = Symbol.for("void.lazy.cached");

const handler: ProxyHandler<any> = {};

for (const method of [
    "apply",
    "construct",
    "defineProperty",
    "deleteProperty",
    "getPrototypeOf",
    "has",
    "isExtensible",
    "preventExtensions",
    "set",
    "setPrototypeOf",
] as const) {
    handler[method] = (target: any, ...args: any[]) => (Reflect[method] as any)(target[SYM_LAZY_GET]?.() ?? target, ...args);
}

handler.ownKeys = target => {
    const v = target[SYM_LAZY_GET]?.() ?? target;
    const keys = Reflect.ownKeys(v);
    for (const key of unconfigurable) {
        if (!keys.includes(key)) keys.push(key);
    }
    return keys;
};

handler.getOwnPropertyDescriptor = (target, p) => {
    if (typeof p === "string" && unconfigurable.includes(p)) return Reflect.getOwnPropertyDescriptor(target, p);

    const resolved = target[SYM_LAZY_GET]?.() ?? target;
    const descriptor = Reflect.getOwnPropertyDescriptor(resolved, p);
    if (descriptor) Object.defineProperty(target, p, descriptor);
    return descriptor;
};

handler.get = (target, p, receiver) => {
    if (p === SYM_LAZY_CACHED || p === SYM_LAZY_GET) return Reflect.get(target, p, receiver);

    const value = target[SYM_LAZY_GET]();
    if (value == null) return;
    if (typeof value === "object" || typeof value === "function") return Reflect.get(value, p, receiver);

    throw new Error("proxyLazy: factory returned a primitive value");
};

const MAX_RETRIES = 50;

export function makeLazy<T>(factory: () => T, maxRetries = MAX_RETRIES, label?: string): () => T {
    let cache: T;
    let resolved = false;
    let attempts = 0;
    return () => {
        if (!resolved) {
            if (attempts >= maxRetries) {
                if (IS_DEV && attempts === maxRetries) {
                    attempts++;
                    logger.warn(`${label ?? "lazy value"} could not be resolved after ${maxRetries} attempts — likely renamed or removed in this Grok build.`);
                }
                return cache;
            }
            cache = factory();
            attempts++;
            if (cache != null) resolved = true;
        }
        return cache;
    };
}

export function proxyLazy<T>(factory: () => T, label?: string): T {
    const getter = makeLazy(factory, MAX_RETRIES, label);
    const proxyDummy = Object.assign(() => {}, {
        [SYM_LAZY_CACHED]: void 0 as T | undefined,
        [SYM_LAZY_GET]() {
            const result = getter();
            proxyDummy[SYM_LAZY_CACHED] = result;
            return result;
        },
    });

    return new Proxy(proxyDummy, handler) as unknown as T;
}
