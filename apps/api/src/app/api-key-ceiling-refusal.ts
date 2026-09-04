/**
 * Which refusal a scoped key gets when it lacks a permission.
 *
 * A Langy session key that asks for something Langy may never delegate is a
 * DIFFERENT refusal from an ordinary key that simply lacks the grant — the
 * first can never be fixed by widening the key, and saying so is the point.
 *
 * Shared by the framework chain's security middleware and the
 * handler-managed-credential port, the two doors that enforce this ceiling,
 * so they cannot decide differently about a caller and cannot drift on what
 * the denial ships. The identifying context (which key, which user, which
 * project) is logged here rather than placed on the error's `meta` — nothing
 * on the client side reads it, so it never leaves the process.
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
