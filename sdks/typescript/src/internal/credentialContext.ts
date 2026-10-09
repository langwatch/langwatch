/**
 * Request-scoped resolved credentials.
 *
 * The CLI daemon is one long-lived process that admits multiple requests
 * concurrently when they share a `(cwd, env, colorLevel)` execution window
 * (see cli/daemon/execution.ts). Device-mode requests do exactly that: the
 * caller environment carries NO API key, so the window fingerprint is
 * identical across two different logged-in users and they run at the same
 * time. Writing the resolved per-user key into the single shared
 * `process.env.LANGWATCH_API_KEY` would let one in-flight request build a
 * service with another request's key the instant a concurrent resolution (or
 * a login/logout) overwrote the global: the cross-identity leak the daemon
 * design says must be structurally impossible.
 *
 * The fix keeps the resolved key out of the global entirely. Each request runs
 * inside a credential HOLDER scope established at the request boundary
 * (`runWithCredentialHolder`, wrapped around the in-process command dispatch
 * and around every daemon request in cli/daemon/execution.ts). The resolver,
 * running later inside that scope, mutates the holder; the API-client factory
 * reads it. Because the holder object identity is fixed per request by
 * `AsyncLocalStorage.run` at the top, and `run` (unlike `enterWith`)
 * propagates the store to every continuation of the wrapped callback, a
 * mutation made mid-command is visible to the service constructed afterward,
 * while a concurrent request in its own holder never observes it. Outside any
 * scope (a plain SDK embed, or a direct unit call) a process-local fallback
 * holder is used, which is safe because those paths are single-request.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface CredentialHolder {
  apiKey?: string;
  projectId?: string;
  requestedProject?: string;
  warnedProjectEnvIgnored?: boolean;
}

const storage = new AsyncLocalStorage<CredentialHolder>();

/**
 * Process-local fallback for callers not wrapped in a holder scope: a plain
 * SDK embed, or a cold-CLI path that skipped the wrapper. Never used inside
 * the daemon, where every request runs inside its own `run`-established
 * holder, so it can never carry one request's key into another.
 */
const fallbackHolder: CredentialHolder = {};

function currentHolder(): CredentialHolder {
  return storage.getStore() ?? fallbackHolder;
}

/**
 * Run `fn` inside a fresh, empty credential holder. Called once at each request
 * boundary (in-process dispatch, and per daemon request). The resolver fills
 * the holder later; everything the request constructs afterward reads it.
 */
export function runWithCredentialHolder<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/**
 * Publish the resolved API key for the current request into its holder. No
 * process-global state is touched, so concurrent requests never collide.
 */
export function setResolvedApiKey(apiKey: string): void {
  currentHolder().apiKey = apiKey;
}

/**
 * The API key resolved for the current request, or undefined when nothing has
 * resolved in this context. Client factories fall back to the environment
 * then, exactly as a plain SDK embed does.
 */
export function scopedApiKey(): string | undefined {
  return currentHolder().apiKey;
}

/**
 * Publish the project the current request targets. A user-scoped API key
 * (`sk-lw-{lookupId}_{secret}`) carries no project identity of its own, so the
 * server resolves the role binding from the project the request names: the
 * resolver decides which project that is (the personal one by default,
 * `--project <id|slug>` otherwise) and every client built afterwards reads it
 * from here. Same request scoping as the key, for the same reason — two
 * concurrent daemon requests can target different projects.
 */
export function setResolvedProjectId(projectId: string | undefined): void {
  currentHolder().projectId = projectId;
}

/**
 * The project id resolved for the current request, or undefined when nothing
 * has resolved in this context. Client factories fall back to
 * `LANGWATCH_PROJECT_ID` then, exactly as a plain SDK embed does.
 */
export function scopedProjectId(): string | undefined {
  return currentHolder().projectId;
}

/**
 * Publish the project the command line pointed this request at, BEFORE any
 * credential resolves: the id or slug as the user typed it, not a resolved id.
 *
 * Set from the `preAction` hook rather than passed down through the commands,
 * so a command inherits `--project` without its action having to accept the
 * value and hand it on (cli/utils/projectOption.ts). The resolver reads it
 * with `requestedProject()` and turns it into the project the request names.
 */
export function setRequestedProject(selector: string | undefined): void {
  currentHolder().requestedProject = selector;
}

/**
 * The project selector the command line asked for in this request, or
 * undefined when it named none. Unresolved on purpose: the resolver decides
 * what a selector means, and it is the only thing that can.
 */
export function requestedProject(): string | undefined {
  return currentHolder().requestedProject;
}

/**
 * Take the right to warn that `LANGWATCH_PROJECT_ID` was ignored, once per
 * request. True the first time it is asked in this holder, false afterwards.
 *
 * Request-scoped rather than process-scoped because the daemon serves many
 * requests from one process: a module-level flag would warn the first caller
 * and leave every later one running against the key's own project with
 * nothing on screen saying so, which is the silence the warning exists to end.
 */
export function claimProjectEnvIgnoredWarning(): boolean {
  const holder = currentHolder();
  if (holder.warnedProjectEnvIgnored) return false;
  holder.warnedProjectEnvIgnored = true;
  return true;
}

/**
 * Clear the process-local fallback holder. Test-only: a unit test that sets a
 * key outside any scope would otherwise leak it into the next test.
 */
export function resetFallbackCredentialHolder(): void {
  fallbackHolder.apiKey = undefined;
  fallbackHolder.projectId = undefined;
  fallbackHolder.requestedProject = undefined;
  fallbackHolder.warnedProjectEnvIgnored = undefined;
}
