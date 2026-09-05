/**
 * Which refusal a scoped key gets when it lacks a permission.
 */
import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  type ResolvedApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import type { Logger } from "@langwatch/observability";

export function apiKeyCeilingRefusal(
  resolved: Extract<ResolvedApiKeyToken, { type: "apiKey" }>,
  permission: AuthzPermission,
  logger: Pick<Logger, "error">,
): HandledError {
  logger.error(
    {
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId ?? null,
      projectId: resolved.project.id,
      permission,
    },
    "API key ceiling denial",
  );
  const langy = resolved.isLangySessionKey ? classifyForLangy(permission) : null;
  if (langy && langy.disposition !== "granted") {
    return new ApiKeyPermissionNotDelegableError(permission, { subject: "Langy" });
  }
  return new ApiKeyPermissionDeniedError(permission);
}
