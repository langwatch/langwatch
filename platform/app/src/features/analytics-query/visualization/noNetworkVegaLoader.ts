/**
 * The repository-owned Vega loader: it refuses every load, so a spec that
 * slipped past static validation still cannot reach the network or the file
 * system.
 *
 * The loader shape is declared structurally rather than imported from `vega`.
 * Importing `vega` here would pull the browser runtime into every module that
 * touches the policy, which is the opposite of what this file is for.
 */

import type { Loader } from "vega";

import { lwqlVegaError } from "./vegaLitePolicy";
import { JSON_POINTER_ROOT } from "./vegaLiteStructure";
import type { VegaValidationError } from "./visualization.types";

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
 * Ties the hand-written shape above to vega's own contract at compile time.
 *
 * Without it, a future change to vega's `Loader` would leave this interface
 * quietly non-conforming, and vega-embed — which reads a non-`Loader` object as
 * `LoaderOptions` — would build a real, network-capable loader in its place.
 * The guarantee this file exists to give would be gone, and nothing would fail.
 *
 * Type-only, so no vega module is evaluated; see the file header.
 */
type AssertLangWatchQLLoaderMatchesVega =
  LangWatchQLVegaLoader extends Pick<Loader, keyof LangWatchQLVegaLoader> ? true : never;
const _lwqlLoaderMatchesVega: AssertLangWatchQLLoaderMatchesVega = true;
void _lwqlLoaderMatchesVega;

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
 * shown or logged. The spec is caller-authored, so its URLs are caller-authored
 * too, and a refusal message must not become the thing that copies a token
 * somewhere it is kept.
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

  return {
    load: (uri) => refuse(uri, "load"),
    sanitize: (uri) => refuse(uri, "sanitize"),
    http: (uri) => refuse(uri, "http"),
    file: (filename) => refuse(filename, "file"),
  };
}
