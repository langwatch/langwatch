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
 * Clear the process-local fallback holder. Test-only: a unit test that sets a
 * key outside any scope would otherwise leak it into the next test.
 */
export function resetFallbackCredentialHolder(): void {
  fallbackHolder.apiKey = undefined;
}
