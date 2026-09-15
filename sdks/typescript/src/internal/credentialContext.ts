/**
 * Request-scoped resolved credentials. The CLI daemon serves concurrent
 * requests from one process; device-mode requests share no API key in the
 * environment, so writing a resolved key into `process.env.LANGWATCH_API_KEY`
 * would let one in-flight request build a service with another's key — the
 * cross-identity leak this holder (an `AsyncLocalStorage` scope established at
 * each request boundary) exists to make structurally impossible.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface CredentialHolder {
  apiKey?: string;
  projectId?: string;
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
 * carries no project identity of its own, so the resolver decides which
 * project the request names (the personal one by default, `--project
 * <id|slug>` otherwise) and every client built afterwards reads it from here.
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
 * Clear the process-local fallback holder. Test-only: a unit test that sets a
 * key outside any scope would otherwise leak it into the next test.
 */
export function resetFallbackCredentialHolder(): void {
  fallbackHolder.apiKey = undefined;
  fallbackHolder.projectId = undefined;
}
