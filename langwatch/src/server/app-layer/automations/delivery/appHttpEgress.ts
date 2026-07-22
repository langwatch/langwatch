import type { HttpEgress } from "@langwatch/automations-server/clients/http/destination";
import {
  fetchWithResolvedIp,
  ssrfSafeFetch,
  type SSRFValidationResult,
} from "~/utils/ssrfProtection";

/**
 * The app's SSRF-fenced egress pair, injected into the package's HTTP
 * destination client (ADR-063 §1). The validator result type is opaque to
 * the package — it flows from a caller's `validateUrl` straight back into
 * `fetchWithResolvedIp` here.
 */
export const appHttpEgress: HttpEgress<SSRFValidationResult> = {
  safeFetch: ssrfSafeFetch,
  fetchWithResolvedIp,
};
