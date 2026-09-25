// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Customer-facing directory state and change copy (ADR-122). */
import type { ScimSyncStatusCopy } from "@langwatch/enterprise-scim-contract";
import { explainHandledError } from "@langwatch/error-presentation/presentation";
import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncLifecycleState,
} from "@langwatch/identity-contract";

/**
 * The remediation for every failed apply, and the reason no surface here
 * offers a retry control.
 */
export const DIRECTORY_FAILURE_REMEDIATION =
  "Your identity provider's next push re-asserts everything it still believes, so fixing this in the directory is what puts it right.";

export function scimSyncStatusCopy({
  state,
  hasPushed,
  revokedCause,
}: {
  /** Null for a connection no token has ever been minted against. */
  state: ScimSyncLifecycleState | null;
  hasPushed: boolean;
  revokedCause: "revoke" | "teardown" | null;
}): ScimSyncStatusCopy {
  if (state === null) {
    return {
      headline: "Not set up yet",
      waitingFor:
        "No directory token has been issued for this connection. Issue one and point your identity provider at it to start provisioning.",
      tone: "waiting",
    };
  }

  switch (state) {
    case "TOKEN_ISSUED":
      return {
        headline: hasPushed ? "Waiting for the next change" : "Waiting for the first push",
        waitingFor: hasPushed
          ? "The token is ready. Point your identity provider at it; the next change it sends will update this status."
          : "The token is ready. Point your identity provider at it and the first push will start the sync.",
        tone: "waiting",
      };
    case "SYNCING":
      return {
        headline: "Syncing",
        waitingFor: hasPushed
          ? "Your identity provider is pushing changes and they are being applied."
          : "Your identity provider is connected and changes are being applied.",
        tone: "working",
      };
    case "ERROR":
      return {
        headline: "Something the directory asked for has not been applied",
        waitingFor: DIRECTORY_FAILURE_REMEDIATION,
        tone: "attention",
      };
    case "REVOKED":
      return {
        headline: "Sync has ended",
        waitingFor:
          revokedCause === "teardown"
            ? "This connection was removed, so the tokens issued for it no longer work."
            : "The token for this connection was revoked, so it no longer provisions anyone.",
        tone: "ended",
      };
  }
}

/**
 * What a directory-caused membership change is called on the customer's
 * surface. The author is always the directory, and saying so is the point: a
 * change nobody in the organization made needs an author a person can name
 * before they go looking for who did it.
 */
export const DIRECTORY_CHANGE_AUTHOR = "Your identity provider";

export function directoryChangeCopy({
  kind,
  person,
}: {
  kind: "attached" | "removed";
  /** The person's name or address, when the change was about one. */
  person: string | null;
}): string {
  const who = person ?? "a group";

  return kind === "removed" ? `${who} lost access` : `${who} was given access`;
}

/**
 * A failure's words come from the shared registry: registered copy where a
 * code has some, the humanised code where it does not, and the remediation
 * standing in for a description the registry left empty.
 */
export function directoryFailureCopy(errorCode: string): { title: string; description: string } {
  const explanation = explainHandledError({
    code: errorCode,
    meta: {},
    httpStatus: 500,
    fault: "platform",
    retryable: false,
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });

  return {
    title: explanation.title,
    description: explanation.description || DIRECTORY_FAILURE_REMEDIATION,
  };
}

/** Who an activity line was about when the person could not be resolved. */
export const DIRECTORY_ACTIVITY_UNKNOWN_PERSON = "a person";

/**
 * One line of the activity feed (ADR-126), said as the directory's act in the
 * provider's vocabulary. A failure's words come from the same registry as the
 * failure panel's, so the two surfaces cannot describe one failure differently.
 */
export function directoryActivityCopy({
  type,
  op,
  person,
  failure,
}: {
  type: string;
  op: string | null;
  person: string | null;
  failure: string | null;
}): string {
  const who = person ?? DIRECTORY_ACTIVITY_UNKNOWN_PERSON;
  switch (type) {
    case SCIM_TOKEN_ISSUED_EVENT_TYPE:
      return "A provisioning token was issued for this connection";
    case SCIM_USER_PUSHED_EVENT_TYPE:
      return `${directoryUserOpCopy(op)} ${who}`;
    case SCIM_GROUP_MAPPED_EVENT_TYPE:
      return "Your directory sent a group";
    case SCIM_APPLY_FAILED_EVENT_TYPE:
      return failure ?? "Something your directory sent could not be applied";
    case SCIM_APPLY_RECOVERED_EVENT_TYPE:
      return "A change that had been failing went through";
    case SCIM_APPLY_RETIRED_EVENT_TYPE:
      return failure
        ? `${failure} — no longer being retried`
        : "A change your directory sent will not be retried again";
    case SCIM_APPLY_REDRIVEN_EVENT_TYPE:
      return "A change that had been given up on was sent through again";
    case SCIM_TOKEN_REVOKED_EVENT_TYPE:
      return "This connection's provisioning token stopped working";
    default:
      return "Your directory did something we have no words for yet";
  }
}

/** The provider's own verb for what it did to somebody. */
function directoryUserOpCopy(op: string | null): string {
  switch (op) {
    case "create":
      return "Your directory added";
    case "update":
      return "Your directory updated";
    case "deactivate":
      return "Your directory switched off access for";
    case "remove":
      return "Your directory removed";
    default:
      return "Your directory sent";
  }
}
