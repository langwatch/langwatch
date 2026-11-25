/**
 * The per-request output context (format, colour). Deliberately CHALK-FREE:
 * a static `chalk` import here would cost every invocation ~4ms of cold
 * start; the one op needing it lives in `errorOutput.ts`, imported lazily.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The output format a command was invoked with. */
export type CliOutputFormat = "json" | "agents" | "text";

interface OutputScope {
  format: CliOutputFormat;
  /** Whether ANSI colour may be emitted for this request. */
  hasColor: boolean;
}

const scopeStorage = new AsyncLocalStorage<OutputScope>();

let ambientFormat: CliOutputFormat = "text";

/**
 * Run `fn` with a fresh output scope. Called by the daemon per request (see
 * `withExecutionContext` in daemon/execution.ts); the in-process path never
 * enters a scope and uses the ambient global instead.
 */
export const withOutputScope = <T>(fn: () => T): T =>
  scopeStorage.run({ format: "text", hasColor: true }, fn);

/** The active request's output scope, if the caller is inside one. */
export const currentOutputScope = (): OutputScope | undefined => scopeStorage.getStore();

export const setOutputFormat = (format: string | undefined): void => {
  const resolved: CliOutputFormat = format === "json" || format === "agents" ? format : "text";
  const scope = scopeStorage.getStore();
  if (scope) scope.format = resolved;
  else ambientFormat = resolved;
};

export const getOutputFormat = (): CliOutputFormat =>
  scopeStorage.getStore()?.format ?? ambientFormat;

/**
 * The format to render a failure in: what the caller explicitly said, else
 * what the command was invoked with. Explicit wins so a command with its
 * own `--format` doesn't depend on the program hook having run.
 */
export const resolveOutputFormat = (explicit?: string): CliOutputFormat => {
  if (explicit === undefined) return getOutputFormat();
  if (explicit === "json") return "json";
  if (explicit === "agents") return "agents";
  return "text";
};
