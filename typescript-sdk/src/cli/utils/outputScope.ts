/**
 * The per-request output context: the format failures render in, and whether
 * colour may reach the caller.
 *
 * This module is deliberately CHALK-FREE. `program.ts` reaches it through
 * `utils/output.ts`, which puts it on the cold-start path of every in-process
 * invocation — and a static `chalk` import here would cost every invocation
 * ~4ms of module load for colour state that only an agent-mode run or an
 * actual failure ever reads. The one operation that needs chalk (turning
 * `chalk.level` off on the ambient, in-process path) lives in
 * `errorOutput.ts`, which `applyOutputContext` imports lazily and only when
 * agent mode actually asks for it.
 *
 * Set once per invocation by the `preAction` hook in `program.ts`, because the
 * ~100 `failSpinner` call sites should not each have to remember to thread an
 * option through to be able to fail correctly — forgetting would mean a command
 * that silently prints prose to a parser. Written on EVERY action (not only
 * when `--format` is passed) so a daemon serving one command after another
 * cannot leak a `json` from the last caller into the next one.
 *
 * Two layers, one mechanism:
 *
 *   - SCOPED: an AsyncLocalStorage scope, entered per request by the daemon
 *     (`daemon/execution.ts withExecutionContext`). Requests that share an
 *     execution window run CONCURRENTLY and can disagree about `--format` and
 *     `--agent`; a plain module global would let the second writer clobber the
 *     first request's error rendering mid-flight.
 *   - AMBIENT: a plain module global, used when no scope is active — the
 *     in-process path (and tests), where exactly one command is in flight and
 *     a global is faithful.
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
export const currentOutputScope = (): OutputScope | undefined =>
  scopeStorage.getStore();

export const setOutputFormat = (format: string | undefined): void => {
  const resolved: CliOutputFormat =
    format === "json" ? "json" : format === "agents" ? "agents" : "text";
  const scope = scopeStorage.getStore();
  if (scope) scope.format = resolved;
  else ambientFormat = resolved;
};

export const getOutputFormat = (): CliOutputFormat =>
  scopeStorage.getStore()?.format ?? ambientFormat;

/**
 * The format to render a failure in: what the caller explicitly said, else what
 * the running command was invoked with. The explicit argument wins so a command
 * that already holds its own `--format` (and a test that passes one) does not
 * depend on the program hook having run.
 */
export const resolveOutputFormat = (
  explicit?: string,
): CliOutputFormat => {
  if (explicit === undefined) return getOutputFormat();
  if (explicit === "json") return "json";
  if (explicit === "agents") return "agents";
  return "text";
};
