/**
 * Repository-owned Vega loader that refuses all loads to block network/filesystem
 * access. Declared structurally to avoid pulling the browser runtime into every module.
 */

import type { Loader } from "vega";

import { lwqlVegaError } from "./vega-lite-policy.ts";
import { JSON_POINTER_ROOT } from "./vega-lite-structure.ts";
import type { VegaValidationError } from "./visualization-types.ts";

/**
 * The subset of Vega's `Loader` a view ever calls. Every method rejects, so the
 * return types matter only for assignability.
 */
export interface LangWatchQLVegaLoader {
  load(uri: string, options?: unknown): Promise<string>;
  sanitize(uri: string, options?: unknown): Promise<{ href: string }>;
  http(uri: string, options?: unknown): Promise<string>;
  file(filename: string): Promise<string>;
}

/**
 * The returned object is checked against Vega's `Loader` contract at the
 * construction seam below. The local interface remains the package's portable
 * surface, so consumers do not need to import Vega just to type a loader.
 */

/** The rejection every loader method produces, carrying its structured refusal. */
export class LangWatchQLVegaLoadBlockedError extends Error {
  readonly detail: VegaValidationError;

  constructor({ reference, method }: { reference: string; method: string }) {
    const blocked = redactResourceReference(reference);
    super(`Chart resource loading is disabled: refused ${method} of ${blocked}.`);
    this.name = "LangWatchQLVegaLoadBlockedError";
    this.detail = lwqlVegaError({
      rule: "loader.blocked",
      path: JSON_POINTER_ROOT,
      message: `This chart tried to load ${blocked}. Charts read only the datasets registered for this result, so the load was refused.`,
      meta: { blocked, method },
    });
  }
}

/**
 * Strips credentials, query and fragment before a blocked reference is ever
 * shown or logged — the spec is caller-authored, so a refusal message must
 * not itself leak a token.
 */
export function redactResourceReference(reference: string): string {
  try {
    const url = new URL(reference);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return reference.split(/[?#]/)[0] ?? reference;
  }
}

/**
 * Builds a loader that refuses everything. A factory rather than a shared
 * constant so a view can never be handed an object another view has mutated.
 */
export function createNoNetworkVegaLoader(): LangWatchQLVegaLoader {
  const refuse = (reference: string, method: string): Promise<never> =>
    Promise.reject(new LangWatchQLVegaLoadBlockedError({ reference, method }));

  const loader = {
    load: (uri) => refuse(uri, "load"),
    sanitize: (uri) => refuse(uri, "sanitize"),
    http: (uri) => refuse(uri, "http"),
    file: (filename) => refuse(filename, "file"),
  } satisfies LangWatchQLVegaLoader & Loader;

  return loader;
}
