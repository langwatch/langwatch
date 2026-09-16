import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

/**
 * Thin wrapper over the 4-source endpoint resolver (flag > env > config >
 * default); new callers should use `resolveControlPlaneEndpoint()` directly.
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
export function getEndpoint(): string {
  return resolveControlPlaneUrl();
}
