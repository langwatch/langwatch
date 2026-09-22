// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Customer-facing directory state and change copy (ADR-122). */
import type { ScimSyncStatusCopy } from "@langwatch/enterprise-scim-contract";
import { explainHandledError } from "@langwatch/error-presentation/presentation";
import type { ScimSyncLifecycleState } from "@langwatch/identity-contract";

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
