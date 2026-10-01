import type { ApiKeyTrpcCreateInput } from "@langwatch/api-key-contract";
import { addDays, nowInstant } from "@langwatch/time";

/** The mint of a personal access token with one project-scoped member grant. */
export function projectTokenInput({
  organizationId,
  projectId,
  name = "Personal access token",
}: {
  organizationId: string;
  projectId: string;
  name?: string;
}): ApiKeyTrpcCreateInput {
  return {
    organizationId,
    name,
    permissionMode: "all",
    keyType: "personal",
    expiresAt: addDays(nowInstant().epochMilliseconds, 90),
    bindings: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: projectId }],
  };
}
