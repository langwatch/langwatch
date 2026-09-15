import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

/**
 * Thin wrapper over the 4-source endpoint resolver (flag > env > persisted
 * config > default) for callers that don't need the `--flag` axis. New
 * callers should use `resolveControlPlaneEndpoint()` directly for source
 * attribution. Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
export function getEndpoint(): string {
  return resolveControlPlaneUrl();
}
