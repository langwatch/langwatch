// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Single source of truth for the public AI Gateway base URL a deployment
 * hands to CLI surfaces (login ceremony, personal-VK reveal card,
 * cliBootstrap). Keeping the fallback in one place stops the SaaS default
 * from drifting between call sites — a `.com`/`.ai` typo in just one copy
 * previously routed SaaS `langwatch <tool>` calls at a parked domain whose
 * TLS cert didn't match, surfacing as a `fetch failed` on every command.
 *
 * Resolution order:
 *   1. publicUrl — `LW_GATEWAY_PUBLIC_URL`, the unambiguous TS-side var.
 *   2. baseUrl   — `LW_GATEWAY_BASE_URL`, legacy fallback for SaaS deploys
 *      where it still carried the public URL before the Go gateway started
 *      hijacking the same name for control-plane discovery.
 *   3. SaaS default `https://gateway.langwatch.ai`.
 *   4. Self-hosted default `http://localhost:5563` (the Go AI gateway port).
 */

/** Canonical SaaS public gateway host. */
export const SAAS_GATEWAY_URL = "https://gateway.langwatch.ai";
/** Local Go AI gateway (per `make service svc=aigateway`). */
export const LOCAL_GATEWAY_URL = "http://localhost:5563";

export function resolveGatewayBaseUrl({
  publicUrl,
  baseUrl,
  isSaas,
}: {
  publicUrl?: string | null;
  baseUrl?: string | null;
  isSaas?: boolean;
}): string {
  return (
    publicUrl ?? baseUrl ?? (isSaas ? SAAS_GATEWAY_URL : LOCAL_GATEWAY_URL)
  );
}
