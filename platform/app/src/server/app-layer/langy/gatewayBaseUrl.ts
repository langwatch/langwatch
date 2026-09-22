/**
 * The gateway's OpenAI-compatible base URL, normalised.
 *
 * Framework-free and dependency-free on purpose. Its callers are spread
 * across layers — the Langy credential service, the codex model handle, the
 * guided-onboarding instance — and the codex handle in particular is reached
 * from `server/modelProviders`, which must not pull the app-layer container
 * (and everything registered in it) in behind one string helper.
 */

/**
 * The Langy worker hands `gatewayBaseUrl` straight to the agent as
 * `OPENAI_BASE_URL`, so it must point at the gateway's OpenAI-compatible
 * surface — the `/v1` prefix under which `/responses` and `/chat/completions`
 * live. `LW_GATEWAY_BASE_URL` is shared with the Go gateway's control-plane
 * discovery and is set without `/v1` in some deployments (the SaaS dev
 * cluster shipped `http://langwatch-gateway:80`), which made the worker POST
 * to `/responses` → 404. Normalise here so Langy is correct regardless of how
 * the deployment spells the env. Idempotent: a value already ending in `/v1`
 * is returned unchanged.
 */
export function ensureGatewayV1BaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
