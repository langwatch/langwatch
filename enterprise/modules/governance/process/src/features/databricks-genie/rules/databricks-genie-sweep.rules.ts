// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie sweep's walk plans, resume points and watermark ceilings. */

import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import type { z } from "zod";

import type { conversationSchema, spaceSchema } from "./databricks-genie-message-event.rules.ts";

/**
 * Anything below this is epoch SECONDS; anything above it is epoch
 * MILLISECONDS. `1e11` splits them with no overlap that can occur in practice:
 * as milliseconds it is 1973-03-03, as seconds it is the year 5138.
 *
 * The unit is not documented. Databricks' own reference and its Genie guide
 * both example `created_timestamp` as `1719769718` — ten digits, seconds — while
 * most other Databricks APIs (Jobs, Dashboards) stamp milliseconds. We could
 * not settle it against a live workspace, and the failure mode of guessing
 * wrong is the one this adapter exists to avoid: a first run's watermark is
 * `now − 30 days`, so seconds read as milliseconds land in January 1970, sit
 * behind every watermark, and the source reports zero messages forever without
 * a single error. Detecting the unit costs one comparison and cannot be wrong
 * for any timestamp this century.
 */
const EPOCH_SECONDS_CEILING = 1e11;

/**
 * How long a message is given to settle before the sweep stops waiting for it.
 *
 * Holding the watermark is what makes an in-flight message get re-read, and a
 * message that never reaches a terminal status would hold it forever — turning
 * a bounded re-read into a permanent one over the whole window. After this it
 * is taken as it stands: whatever attachments it had are what we keep.
 */
export const PENDING_SETTLE_GRACE_MS = 60 * 60 * 1000;

/**
 * What one sweep read, and whether it read all of it.
 *
 * TWO flags gate the watermark, and it needs both:
 *
 *   `complete` — the walk read everything it REACHED. False when the budget
 *   ran out, the deadline hit, or a listing was truncated; in every one of
 *   those cases the walk stopped where it was and the resume point says where.
 *
 *   `hadGap` — the walk reached PAST something it could not read. The resume
 *   point cannot express this, because the position moved beyond the hole.
 *
 * A sweep is whole only when it is complete AND had no gap. `hadGap` is
 * sweep-scoped here, not run-scoped: it is seeded from the in-flight cursor,
 * so a space skipped in run 1 still holds the watermark when run 4 finishes.
 */
export interface SweepResult {
  events: NormalizedPullEvent[];
  complete: boolean;
  /** Which space to start at next run, when the budget cut this one short. */
  resumeSpaceId: string | null;
  /** Where inside that space to start, or null to take it from the top. */
  resumeConversationId: string | null;
  /**
   * Whether this run walked PAST something it could not read.
   *
   * Distinct from `complete`, which also covers the ordinary "ran out of
   * budget, will carry on next run" case. A gap is the case the resume point
   * cannot express, because the position moved beyond the hole — see
   * `cursorSchema.sweepHadGap`.
   */
  hadGap: boolean;
  /**
   * The oldest message this sweep saw that may still change, or null.
   *
   * A CEILING on the next watermark rather than a veto on it — see `earliest`.
   */
  oldestPendingMs: number | null;
  /** The space set this sweep is walking, for the next run to compare against. */
  spaceSetFingerprint: string;
}

/** One page of a Databricks list endpoint, and whether more were left unread. */
export interface PagedRead<T> {
  items: T[];
  complete: boolean;
}

/** What one space's walk read, and where to pick it up if it was cut short. */
export interface SpaceRead {
  items: NormalizedPullEvent[];
  complete: boolean;
  /**
   * The conversation to restart this space at, or null for "from the top".
   *
   * Null does not mean "finished" — read it together with `complete`. A space
   * whose conversation LISTING was itself cut short reports `complete: false`
   * with a null resume point, because a partial list has no trustworthy
   * position in it to resume from.
   *
   * `hadGap` says the walk carried on past a conversation it could not read,
   * which the resume point cannot express — see `cursorSchema.sweepHadGap`.
   */
  resumeConversationId: string | null;
  hadGap: boolean;
  /** The oldest message in this space that may still change, or null. */
  oldestPendingMs: number | null;
}

/** Databricks' integer timestamp, in whichever unit it arrived, as epoch ms. */
export function genieEpochMs(value: number): number {
  return value < EPOCH_SECONDS_CEILING ? value * 1000 : value;
}

/**
 * The earlier of a watermark ceiling and a new one, treating null as "no ceiling".
 *
 * An unsettled message must not FREEZE the window, only hold it back to just
 * before itself. A workspace with real traffic has something mid-answer nearly
 * every time the sweep looks, so a boolean hold would stop `sinceMs` advancing
 * on exactly the workspaces that matter: the re-read window would grow by one
 * interval every interval until a sweep no longer fit in its request budget.
 */
export function earlierOf(a: number | null, b: number): number {
  if (a === null) return b;
  return Math.min(a, b);
}

/**
 * The spaces to sweep in a deterministic order, plus where to start.
 *
 * Exactly the same argument as `conversationWalkPlan`, one level up, and for
 * exactly the same reason: resuming skips everything before the resume point,
 * which is only sound if a space cannot move across it between runs.
 * `/api/2.0/genie/spaces` carries no ordering guarantee either, so a space that
 * existed when the sweep began could sit after the resume point on one run and
 * before it on the next, never be read, and then fall outside the window once
 * the completed sweep advanced the watermark. Sorting on the immutable
 * `space_id` removes the dependency on the API's order.
 *
 * `resumable` is false when the space listing was itself truncated: a partial
 * list has no trustworthy position in it, so the sweep restarts from the top.
 */
export function spaceWalkPlan({
  spaces,
  resumeSpaceId,
  resumeFingerprint,
}: {
  spaces: PagedRead<z.infer<typeof spaceSchema>>;
  resumeSpaceId: string | null;
  resumeFingerprint: string | null;
}): {
  ordered: z.infer<typeof spaceSchema>[];
  startAt: number;
  resumable: boolean;
  fingerprint: string;
} {
  const ordered = [...spaces.items].toSorted((a, b) => {
    if (a.space_id < b.space_id) return -1;
    if (a.space_id > b.space_id) return 1;
    return 0;
  });
  const fingerprint = ordered.map((s) => s.space_id).join("\u0000");
  // A set that changed under the sweep invalidates the position outright — see
  // `cursorSchema.spaceSetFingerprint`. Deletion alone is already safe (the
  // `Math.max` below restarts from the top), but an ADDITION sorting before the
  // resume point would be skipped and then dropped.
  const resumable =
    spaces.complete && (resumeFingerprint === null || resumeFingerprint === fingerprint);
  // An id no longer in the list means the space was deleted since the cursor
  // was written; starting over only ever re-reads, and the watermark is held.
  const startAt =
    resumable && resumeSpaceId
      ? Math.max(
          ordered.findIndex((s) => s.space_id === resumeSpaceId),
          0,
        )
      : 0;
  return { ordered, startAt, resumable, fingerprint };
}

/**
 * One space's conversations in a deterministic order, plus where to start.
 *
 * The sort is the load-bearing part — see `spaceMessages` for why resuming is
 * only sound against an order we impose rather than the one the workspace
 * happened to return.
 *
 * `resumable` is false when the listing was itself cut short. A partial list
 * is only a PREFIX of the space's conversations, so a position inside it means
 * nothing: the conversations that would have sorted earlier may sit on a page
 * that was never read, and resuming into it would skip them permanently once
 * the sweep completed. Such a space restarts from the top instead — slower,
 * and still lossless.
 */
export function conversationWalkPlan({
  conversations,
  resumeConversationId,
}: {
  conversations: PagedRead<z.infer<typeof conversationSchema>>;
  resumeConversationId: string | null;
}): {
  ordered: z.infer<typeof conversationSchema>[];
  startAt: number;
  resumable: boolean;
} {
  const ordered = [...conversations.items].toSorted((a, b) => {
    if (a.conversation_id < b.conversation_id) return -1;
    if (a.conversation_id > b.conversation_id) return 1;
    return 0;
  });
  const resumable = conversations.complete;
  // An id no longer in the list means the conversation was deleted since the
  // last run; starting the space over is safe for the same reason as a space.
  const startAt =
    resumable && resumeConversationId
      ? Math.max(
          ordered.findIndex((c) => c.conversation_id === resumeConversationId),
          0,
        )
      : 0;
  return { ordered, startAt, resumable };
}

/**
 * The result for a sweep that stopped early, on the given space.
 *
 * The resume point is dropped when the space listing was not resumable, which
 * restarts the sweep from the top rather than resuming into a position that was
 * never trustworthy.
 */
export function sweptUpTo({
  events,
  space,
  at,
  hadGap,
  oldestPendingMs,
  spacePlan,
}: {
  events: NormalizedPullEvent[];
  space: z.infer<typeof spaceSchema>;
  at: string | null;
  hadGap: boolean;
  oldestPendingMs: number | null;
  spacePlan: { resumable: boolean; fingerprint: string };
}): SweepResult {
  return {
    events,
    complete: false,
    resumeSpaceId: spacePlan.resumable ? space.space_id : null,
    resumeConversationId: spacePlan.resumable ? at : null,
    hadGap,
    oldestPendingMs,
    spaceSetFingerprint: spacePlan.fingerprint,
  };
}

/**
 * The result for a space walk that stopped early on a given conversation.
 *
 * The resume point is dropped when the plan says the space is not resumable
 * (a truncated listing), which turns the next run into a clean restart of the
 * space rather than a resume into a position that was never trustworthy.
 */
export function stoppedAt({
  items,
  conversation,
  hadGap,
  oldestPendingMs,
  conversationPlan,
}: {
  items: NormalizedPullEvent[];
  conversation: z.infer<typeof conversationSchema>;
  hadGap: boolean;
  oldestPendingMs: number | null;
  conversationPlan: { resumable: boolean };
}): SpaceRead {
  return {
    items,
    complete: false,
    resumeConversationId: conversationPlan.resumable ? conversation.conversation_id : null,
    hadGap,
    oldestPendingMs,
  };
}
