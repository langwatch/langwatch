import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

/**
 * Returns the LangWatch endpoint with any trailing slashes stripped, so callers
 * can safely concatenate paths like `${endpoint}/authorize` without producing
 * `https://app.langwatch.ai//authorize`.
 *
 * Delegates to the single 4-source resolver (flag > env > persisted config >
 * default). This is a thin wrapper preserved for callers that don't need the
 * `--flag` axis. New callers should use `resolveControlPlaneEndpoint()`
 * directly so the source attribution is available.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
export function getEndpoint(): string {
  return resolveControlPlaneUrl();
}
