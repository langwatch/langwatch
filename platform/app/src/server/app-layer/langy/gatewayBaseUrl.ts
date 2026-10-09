/**
 * Why `ensureGatewayV1BaseUrl` sits in a module of its own.
 *
 * Its callers are on both sides of a layer boundary: the Langy credential
 * service and the guided-onboarding instance above, the codex model handle
 * below. That handle is reached from `server/modelProviders`, so leaving the
 * helper on the credential service made a connection ping import the
 * app-layer container, and everything registered in it, behind one string
 * function. Framework-free and dependency-free is what keeps that shut.
 */

/**
 * The Langy worker hands `gatewayBaseUrl` straight to the agent as
 * `OPENAI_BASE_URL`, so it must point at the gateway's OpenAI-compatible
 * surface, the `/v1` prefix under which `/responses` and `/chat/completions`
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
