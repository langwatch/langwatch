/** Removal follows lifecycle state: discard setup drafts, tear down live connections. */
import type { SsoConnectionLifecycleState } from "@langwatch/identity";

export type ConnectionRemovalAct =
  /**
   * Pre-live. `discardConnection`, immediately, and the journey opens back
   * on the register step.
   */
  | { verb: "discard" }
  /**
   * Live or paused, and no removal is scheduled yet. `removeConnection`,
   * which schedules teardown with its grace.
   */
  | { verb: "teardown"; alreadyScheduled: false }
  /**
   * Already on its way out. Still `removeConnection`: the aggregate accepts
   * a re-ask from TEARDOWN_PENDING and re-derives the deadline from it,
   * which is how an organization that stopped routing off the connection
   * brings the date forward instead of waiting out a grace protecting
   * nobody.
   */
  | { verb: "teardown"; alreadyScheduled: true }
  /**
   * Nothing left to remove. The setup read excludes terminal states, so this
   * is unreachable from that screen today — it is here because a table with
   * a hole in it renders the hole.
   */
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

export function connectionRemovalActFor(
  state: SsoConnectionLifecycleState,
): ConnectionRemovalAct {
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

/** The caller formats dates; this module describes each removal's effects. */
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
