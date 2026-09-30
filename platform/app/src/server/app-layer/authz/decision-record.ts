import type { AuthzDenialReason, DeclaredScopeId } from "@langwatch/authz";
import { createLogger } from "@langwatch/observability";
import { principalFields, type SessionPrincipal } from "./principal";

const logger = createLogger("langwatch:authz:decision");

/**
 * What one authorization decision records about who made it (D06).
 *
 * Every decision names BOTH people. On an ordinary request they are the same
 * person and the record says so; under an impersonation the actor is the
 * operator and the subject is the person whose access is being borrowed, and
 * the audit trail can answer who really did it rather than only whose account
 * it happened in.
 *
 * The record is built as a value and logged separately, so the content is
 * testable without reaching for the logger: "the decision names both people"
 * is a property of this function, not of a log transport.
 */
export interface PermissionDecisionRecord {
  permission: string;
  scopeTier: DeclaredScopeId["tier"];
  scopeId: string;
  permitted: boolean;
  denialReason: AuthzDenialReason | null;
  /** Who really made the request. */
  actorUserId: string;
  /** Whose access it exercised. Equal to the actor on an ordinary request. */
  subjectUserId: string;
  impersonating: boolean;
}

export function permissionDecisionRecord({
  principal,
  permission,
  scope,
  permitted,
  denialReason = null,
}: {
  principal: SessionPrincipal;
  permission: string;
  scope: DeclaredScopeId;
  permitted: boolean;
  denialReason?: AuthzDenialReason | null;
}): PermissionDecisionRecord {
  return {
    permission,
    scopeTier: scope.tier,
    scopeId: scope.id,
    permitted,
    denialReason,
    ...principalFields(principal),
  };
}

/**
 * Where the record goes.
 *
 * An impersonated decision is evidence somebody will one day come looking
 * for, so it is INFO and kept. An ordinary decision — the overwhelming
 * majority, several per request — is DEBUG, because a line per permission
 * check at info level would drown the log it is supposed to make searchable
 * and would tell nobody anything the request line does not already say.
 */
export function recordPermissionDecision(
  record: PermissionDecisionRecord,
): void {
  if (record.impersonating) {
    logger.info(
      record,
      "authorization decision made under impersonation; both the operator and the person whose access was borrowed are named",
    );
    return;
  }
  logger.debug(record, "authorization decision");
}

/** The pair a session carries, or the caller acting as themselves. */
export function principalOfSession({
  session,
}: {
  session: {
    user: { id: string; impersonator?: { id: string } };
    principal?: SessionPrincipal;
  };
}): SessionPrincipal {
  if (session.principal) return session.principal;
  // A session built without a principal — a test fixture, an embedded caller
  // — still names both people when it carries an impersonator, and otherwise
  // is somebody acting as themselves. Never an invented impersonation.
  const impersonatorId = session.user.impersonator?.id;
  if (impersonatorId && impersonatorId !== session.user.id) {
    return {
      actor: { userId: impersonatorId },
      subject: { userId: session.user.id },
    };
  }
  return {
    actor: { userId: session.user.id },
    subject: { userId: session.user.id },
  };
}
