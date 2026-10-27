/**
 * What one door decision says about who made it (mfa-and-session-shape.feature, as main).
 * Built as a value and logged apart, so "the decision names both people" is a property of
 * this function, not of a log transport.
 */
import type {
  AuthzDeclaredScopeId,
  AuthzDenialReason,
  AuthzPermission,
} from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";

import type { AccessActor } from "./access.ts";

const logger = createLogger("langwatch:authz:decision");

/** Under impersonation the operator acts and the subject is whose access was borrowed. */
export function permissionDecisionRecord({
  actor,
  permission,
  scope,
  permitted,
  denialReason = null,
}: {
  actor: AccessActor;
  permission: AuthzPermission;
  scope: AuthzDeclaredScopeId;
  permitted: boolean;
  denialReason?: AuthzDenialReason | null;
}) {
  const operatorId = actor.type === "user" ? actor.impersonatorId : undefined;
  const actorUserId = operatorId ?? actor.id;

  return {
    permission,
    scopeTier: scope.tier,
    scopeId: scope.id,
    permitted,
    denialReason,
    actorType: actor.type,
    actorUserId,
    subjectUserId: actor.id,
    impersonating: actorUserId !== actor.id,
  };
}

/** An impersonated decision is evidence somebody will come looking for: info; the rest debug. */
export function recordPermissionDecision(
  record: ReturnType<typeof permissionDecisionRecord>,
): void {
  if (record.impersonating) {
    logger.info(
      record,
      "authorization decision under impersonation names the operator and subject",
    );
    return;
  }
  logger.debug(record, "authorization decision");
}
