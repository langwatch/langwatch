import type { FC, PropsWithChildren } from './';
export interface Context<T> extends FC<PropsWithChildren<{
    value: T;
}>> {
    values: T[];
    Provider: FC<PropsWithChildren<{
        value: T;
    }>>;
}
export declare const globalContexts: Context<unknown>[];
/** Per-render context store, isolated per request so values never leak across renders. */
type RenderStore = WeakMap<Context<unknown>, unknown[]>;
/**
 * Establish the request-scoped context store for a render.
 *
 * `resumeStore` continues a suspended subtree in the same store on the fallback
 * path (ignored when `AsyncLocalStorage` is available, where isolation is
 * automatic).
 *
 * Without `AsyncLocalStorage` a render can't be followed across `await`, so the
 * store lives in `fallbackStore` only during synchronous work (mirroring
 * React's request storage). Reading context after `await` then finds no store
 * and falls back to the default value — never another request's value.
 */
export declare const runWithRenderContext: <T>(callback: () => T, resumeStore?: RenderStore) => T;
/**
 * Capture the current render store and return a resumer that re-establishes it
 * around a deferred continuation (e.g. a re-render after a suspended promise
 * settles). Shared by every suspension point so none reimplements it.
 */
export declare const captureRenderContext: () => (<T>(callback: () => T) => T);
/**
 * Create a context whose value can be provided with `<Context.Provider>` and
 * read with {@link useContext}.
 *
 * Server-side renders are isolated per request, so a provided value never leaks
 * into a concurrent request — even across `await` in an async component, when
 * `AsyncLocalStorage` is available (Node.js >= 20.16, Deno, Bun, Cloudflare
 * Workers with `nodejs_compat`). Without it, reading context after `await`
 * returns the default value; synchronous components and `use()`-based
 * suspension are unaffected.
 */
export declare const createContext: <T>(defaultValue: T) => Context<T>;
/**
 * Read the current value of a context created with {@link createContext}.
 *
 * Safe to call from async components after `await`. See {@link createContext}
 * for the per-runtime isolation guarantees.
 */
export declare const useContext: <T>(context: Context<T>) => T;
export {};
