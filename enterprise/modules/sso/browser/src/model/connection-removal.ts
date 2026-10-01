// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Removal follows lifecycle state: discard setup drafts, tear down live connections. */
import type { SsoConnectionLifecycleState } from "@langwatch/identity-contract";

export type ConnectionRemovalAct =
  /** Pre-live: discarded immediately, and the journey reopens at register. */
  | { verb: "discard" }
  /** Live or paused: teardown, scheduled with its grace. */
  | { verb: "teardown"; alreadyScheduled: false }
  /**
   * Already on its way out. Still teardown: the aggregate accepts a re-ask and
   * re-derives the deadline, which is how an organization that already stopped
   * routing brings the date forward instead of waiting out a grace protecting
   * nobody.
   */
  | { verb: "teardown"; alreadyScheduled: true }
  /** Nothing left to remove; here because a table with a hole renders it. */
  | { verb: "none" };

const REMOVAL_ACT: Record<SsoConnectionLifecycleState, ConnectionRemovalAct> = {
  DRAFT: { verb: "discard" },
  CLAIMED: { verb: "discard" },
  APPROVED: { verb: "discard" },
  REJECTED: { verb: "discard" },
  VERIFICATION_PENDING: { verb: "discard" },
  VERIFIED: { verb: "discard" },
  ACTIVE: { verb: "teardown", alreadyScheduled: false },
  SUSPENDED: { verb: "teardown", alreadyScheduled: false },
  TEARDOWN_PENDING: { verb: "teardown", alreadyScheduled: true },
  DISCARDED: { verb: "none" },
  TORN_DOWN: { verb: "none" },
};

export function connectionRemovalActFor(state: SsoConnectionLifecycleState): ConnectionRemovalAct {
  return REMOVAL_ACT[state];
}

export interface ConnectionRemovalCopy {
  /** What this press will do, in the reader's terms. */
  explanation: string;
  /** The button that opens the confirmation. */
  open: string;
  /** The destructive button inside it. */
  confirm: string;
}

/** The caller formats dates; this describes each removal's effects. */
export function connectionRemovalCopyFor({
  act,
  providerName,
  scheduledFor,
}: {
  act: Exclude<ConnectionRemovalAct, { verb: "none" }>;
  providerName: string;
  scheduledFor: string | null;
}): ConnectionRemovalCopy {
  if (act.verb === "discard") {
    return {
      explanation: `Removing ${providerName} takes you back to the start. Nothing about anybody's sign-in changes, and you can register a connection again at any time.`,
      open: "Remove this connection",
      confirm: "Yes, remove it",
    };
  }

  if (act.alreadyScheduled) {
    return {
      explanation:
        scheduledFor === null
          ? `${providerName} is already being removed. New SSO sign-ins and SCIM provisioning have stopped. Existing sessions and member access remain active. You can bring final removal forward to now.`
          : `${providerName} is already being removed, on ${scheduledFor}. New SSO sign-ins and SCIM provisioning have stopped. Existing sessions and member access remain active. You can bring final removal forward to now.`,
      open: "Remove now",
      confirm: "Yes, remove now",
    };
  }

  return {
    explanation: `Removing ${providerName} immediately stops new SSO sign-ins and SCIM provisioning. Existing sessions and member access remain active. Everyone must have another verified sign-in method before you continue. Final removal is scheduled and cannot be cancelled.`,
    open: "Remove this connection",
    confirm: "Yes, schedule the removal",
  };
}
