/**
 * Request-scoped resolved credentials: the CLI daemon serves concurrent
 * requests from one process, so a resolved key in `process.env` would leak
 * across requests -- this holder makes that structurally impossible.
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
 * the daemon, where every request runs in its own holder.
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
 * Publishes the project the current request targets. A user-scoped API key
 * carries no project identity, so the resolver decides which project the
 * request names, and every client built afterwards reads it from here.
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
