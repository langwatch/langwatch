/**
 * Request-scoped resolved credentials: the CLI daemon serves concurrent
 * requests from one process, so a resolved key in `process.env` would leak
 * across requests -- this holder makes that structurally impossible.
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
 * Clear the process-local fallback holder. Test-only: a unit test that sets a
 * key outside any scope would otherwise leak it into the next test.
 */
export function resetFallbackCredentialHolder(): void {
  fallbackHolder.apiKey = undefined;
  fallbackHolder.projectId = undefined;
}
