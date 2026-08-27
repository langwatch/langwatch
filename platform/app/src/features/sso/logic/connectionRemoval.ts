/**
 * Which way OUT a connection has, read from where it stands.
 *
 * There are two removals and they are not interchangeable. A connection that
 * never carried anybody is DISCARDED — immediate, reversible only in the
 * sense that registering again costs nothing. A connection that reached
 * ACTIVE leaves through teardown, which is scheduled, graced, and refused
 * while somebody would be left with no other way in.
 *
 * The screen used to pick between them by asking whether the connection was
 * activated, meaning `state === "ACTIVE"` and nothing else. That reads as the
 * same question and is not: a SUSPENDED connection is not activated and has
 * very much gone live, and one already on its way out is not activated
 * either. Both took the discard branch, and the aggregate refuses a discard
 * from either — so the danger zone offered a button whose only possible
 * outcome was a refusal, and an administrator pressing it learned nothing
 * except that removal was broken.
 *
 * So the question is asked of the LIFECYCLE STATE, which is the fact the
 * aggregate's own guard consults, and the table below is the same partition
 * that guard enforces: `ALLOWED_FROM[discardConnection]` on one side,
 * `ALLOWED_FROM[requestTeardown]` on the other. Keeping it total means the
 * one state nobody thought about renders something deliberate rather than
 * whichever branch a boolean happened to fall into.
 *
 * Framework-free, so the partition can be pinned by a test that renders
 * nothing.
 */

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

/**
 * What the danger zone SAYS, which differs by act as much as the act does.
 *
 * Beside the partition rather than in the component, for the same reason the
 * status chip's words live beside its tones: the sentence a customer reads
 * when they are about to remove their organization's sign-in is worth pinning
 * by a test, and a test that has to render Chakra to read one string pins it
 * badly.
 *
 * `scheduledFor` is the already-formatted date, so this module stays free of
 * locale decisions the caller is better placed to make. A scheduled removal
 * whose date is somehow missing still says it is scheduled — the date is the
 * detail, "this is already happening" is the news.
 */
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
          ? `${providerName} is already being removed. Sign-in keeps working until the removal completes, and asking again re-schedules it from now.`
          : `${providerName} is already being removed, on ${scheduledFor}. Sign-in keeps working until then, and asking again re-schedules it from now.`,
      open: "Re-schedule the removal",
      confirm: "Yes, re-schedule it",
    };
  }
  return {
    explanation: `Removing ${providerName} schedules it: sign-in keeps working through the grace period, and it is refused while anybody would have no other way in.`,
    open: "Remove this connection",
    confirm: "Yes, schedule the removal",
  };
}
