// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Transcript rows grouped into conversations: which row belongs to which conversation, which of
 * its stored batches are actually present, and the activities of one conversation in the order
 * they happened. A row the mapper cannot date or place is dropped rather than guessed at.
 */

import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import {
  MS_THRESHOLD,
  ROLE_AGENT,
  ROLE_USER,
  type Activity,
  type BotFacts,
  type ConversationBucket,
  type ConversationGroup,
  type IndexedRow,
  type TranscriptRow,
} from "../rules/copilot-transcript.rules.ts";
import { toEpochMs } from "@langwatch/time";

export class CopilotTranscriptGroupingService {
  private constructor() {}

  static create(): CopilotTranscriptGroupingService {
    return new CopilotTranscriptGroupingService();
  }

  /**
   * Both spellings of the role, because Bot Framework has two.
   *
   * Every activity in the capture carries the numeric form, so that is what the
   * fixtures use and what the mapper is built around. But `RoleTypes` in the SDK
   * is a string enum, and an activity that reached Dataverse through a different
   * channel can arrive spelled that way. Reading only the numbers would attribute
   * such a message to neither side and lose the turn.
   */
  static tryRoleOf(raw: unknown): number | null {
    if (raw === ROLE_USER || raw === ROLE_AGENT) {
      return raw;
    }

    if (typeof raw === "string") {
      const normalized = raw.toLowerCase();
      if (normalized === "user") {
        return ROLE_USER;
      }

      if (normalized === "bot") {
        return ROLE_AGENT;
      }
    }

    return null;
  }

  /** Bot Framework stamps seconds in `timestamp` and ms in `timestampMs`. */
  static tryActivityMs(activity: Activity): number | null {
    const ms = activity.timestampMs;
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
      return ms;
    }

    const raw = activity.timestamp;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw < MS_THRESHOLD ? raw * 1000 : raw;
    }

    if (typeof raw === "string") {
      const parsed = toEpochMs(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  static tryAsObject(value: unknown): Record<string, unknown> | null {
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);

        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }

    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  }

  static tryParseRow(event: NormalizedPullEvent): TranscriptRow | null {
    const row = CopilotTranscriptGroupingService.tryAsObject(event.raw_payload);

    return row ? (row as TranscriptRow) : null;
  }

  /**
   * The batch number, read from the metadata blob.
   *
   * Two things about it that a plain sort gets wrong. It lives inside a JSON
   * string rather than a column, so Dataverse cannot order or filter on it and
   * the merge has to happen here. And it is a number, so batches 2 and 10 sort
   * as 2 then 10 — sorting the values as text puts 10 first and silently
   * reorders a conversation.
   */
  static tryBatchIdOf(row: TranscriptRow): number | null {
    const metadata = CopilotTranscriptGroupingService.tryAsObject(row.metadata);
    const raw = metadata?.BatchId;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
      return raw;
    }

    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      return Number(raw);
    }

    return null;
  }

  /**
   * What groups rows into one conversation: the stored name, used whole.
   *
   * The name happens to look like a conversation id and a bot id joined by an
   * underscore. Microsoft documents that as a shape they observed, not one they
   * promise, so splitting on the underscore would make our identifiers depend
   * on a format nobody committed to — and the failure would be silent, since a
   * name that stopped matching the shape would still produce *an* identifier,
   * just a different one, orphaning every conversation pulled before the change.
   *
   * The start time was part of this key and had to come out. Someone who leaves
   * a conversation idle past the session timeout and then keeps talking gets a
   * second row: same name, same batch number, a later start time. Keying on the
   * start time made that one conversation into two traces on two thread ids,
   * and the trace list showed only the newer half — which is exactly what the
   * whole `name` is for, since it already carries the conversation's own id.
   */
  static tryConversationKeyOf(row: TranscriptRow): string | null {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) {
      return null;
    }

    return name;
  }

  /** True when the batch numbers held skip one, e.g. 0 and 2 with no 1. */
  static hasBatchGap(batches: number[]): boolean {
    if (batches.length < 2) {
      return false;
    }

    const sorted = [...new Set(batches)].sort((a, b) => a - b);

    return sorted[sorted.length - 1]! - sorted[0]! !== sorted.length - 1;
  }

  /**
   * Take what this event knows about the agent.
   *
   * Bot facts repeat identically across a conversation's rows; the first row
   * that carries them wins, so a later batch missing the join does not erase
   * what an earlier one knew. A fact newly carried on the pulled event is read
   * across into `BotFacts` here.
   */
  static rememberBotFacts(params: { bot: BotFacts; extra: Record<string, unknown> }): void {
    const { bot, extra } = params;
    if (!bot.botName && typeof extra.botName === "string") {
      bot.botName = extra.botName;
    }

    if (!bot.modifiedOn && typeof extra.botModifiedOn === "string") {
      bot.modifiedOn = extra.botModifiedOn;
    }
  }

  /** Bucket the run's rows by the conversation each belongs to. */
  static bucketRowsByConversation(events: NormalizedPullEvent[]): Map<string, ConversationBucket> {
    const byKey = new Map<string, ConversationBucket>();
    for (const event of events) {
      const row = CopilotTranscriptGroupingService.tryParseRow(event);
      if (!row) {
        continue;
      }

      const key = CopilotTranscriptGroupingService.tryConversationKeyOf(row);
      if (!key) {
        continue;
      }

      const existing = byKey.get(key) ?? { rows: [], bot: {} };
      existing.rows.push({ batchId: CopilotTranscriptGroupingService.tryBatchIdOf(row), row });
      CopilotTranscriptGroupingService.rememberBotFacts({
        bot: existing.bot,
        extra: event.extra ?? {},
      });
      byKey.set(key, existing);
    }

    return byKey;
  }

  /**
   * Batch order, then arrival order within a batch, with unbatched rows last.
   *
   * Returning 1 for both `(a,b)` and `(b,a)` when neither has a batch is an
   * inconsistent comparator, and what it decides is not "unspecified order" in
   * a harmless sense: turns are paired by walking the merged activities, so two
   * rows that swap put an answer before its question. Hence the arrival index.
   */
  static byBatchThenArrival(a: IndexedRow, b: IndexedRow): number {
    if (a.batchId === null && b.batchId === null) {
      return a.index - b.index;
    }

    if (a.batchId === null) {
      return 1;
    }

    if (b.batchId === null) {
      return -1;
    }

    return a.batchId === b.batchId ? a.index - b.index : a.batchId - b.batchId;
  }

  /**
   * True for something that can be read as an activity.
   *
   * Each element is checked, not just the array. `content` is a JSON string the
   * row schema validates as a string and never opens, so this is the only place
   * anything looks inside it. A `null` element passes `Array.isArray` happily
   * and then throws on the first property read — and the caller has no
   * try/catch, so one malformed activity would take down routing for every
   * conversation in the run, not just its own.
   */
  static isActivityObject(value: unknown): value is Activity {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  /** Every activity these rows hold, in row order. */
  static activitiesOf(rows: IndexedRow[]): Activity[] {
    const activities: Activity[] = [];
    for (const { row } of rows) {
      const list = CopilotTranscriptGroupingService.tryAsObject(row.content)?.activities;
      if (!Array.isArray(list)) {
        continue;
      }

      for (const entry of list) {
        if (CopilotTranscriptGroupingService.isActivityObject(entry)) {
          activities.push(entry);
        }
      }
    }

    return activities;
  }

  /**
   * The activities in time order, with an undateable one left where it lies.
   *
   * The dated activities are sorted among themselves and put back into the
   * slots dated activities already held, so an undateable one keeps its literal
   * position. Ranking them by comparator instead does not work: a rule that
   * compares null against a number by position and every other pair by time
   * contradicts itself — position says A before B, time says the reverse — and
   * a comparator that contradicts itself is answered with whatever the engine
   * likes. One undated activity was enough to leave the largest timestamp
   * sitting first, which is the exact failure this sort exists to prevent.
   */
  static timeOrderActivities(activities: Activity[]): Activity[] {
    const sortable = activities.map((activity, index) => ({
      activity,
      index,
      ms: CopilotTranscriptGroupingService.tryActivityMs(activity),
    }));
    const dated: { activity: Activity; index: number; ms: number }[] = [];
    for (const item of sortable) {
      if (item.ms !== null) {
        dated.push({ activity: item.activity, index: item.index, ms: item.ms });
      }
    }

    dated.sort((a, b) => (a.ms === b.ms ? a.index - b.index : a.ms - b.ms));
    let nextDated = 0;

    return sortable.map((item) =>
      item.ms === null ? item.activity : dated[nextDated++]!.activity,
    );
  }

  /** True when the conversation happened while someone was building the agent. */
  static isDesignModeConversation(activities: Activity[]): boolean {
    return activities.some(
      (a) =>
        a.valueType === "ConversationInfo" &&
        CopilotTranscriptGroupingService.tryAsObject(a.value)?.isDesignMode === true,
    );
  }

  /** One bucket's rows merged into the conversation they describe. */
  static conversationGroupOf(params: {
    key: string;
    bucket: ConversationBucket;
  }): ConversationGroup {
    const { key, bucket } = params;
    const ordered = bucket.rows
      .map((row, index) => ({ ...row, index }))
      .sort((a, b) => CopilotTranscriptGroupingService.byBatchThenArrival(a, b));
    const batches = ordered.map((r) => r.batchId).filter((b): b is number => b !== null);
    const activities = CopilotTranscriptGroupingService.activitiesOf(ordered);

    return {
      key,
      // Batch order, then time. Batch order alone is right whenever the rows
      // arrive as written, and this is what makes it right when they do not:
      // turns are paired by walking this list, so one out-of-order message
      // attaches an answer to the wrong question.
      activities: CopilotTranscriptGroupingService.timeOrderActivities(activities),
      bot: bucket.bot,
      batches,
      // A hole in the batch numbers we hold — 0 and 2 with no 1 — is a piece
      // of the conversation that is genuinely missing. It still routes, a
      // partial transcript beating none, but it is marked so nobody reads it
      // as the whole exchange.
      //
      // Deliberately not "batch 0 is absent", which was the first rule here
      // and is wrong for an ordinary reason: batches carry different
      // `createdon` values, so a pull window can end between them. The run
      // holding only batch 1 would flag a conversation whose opening arrived
      // perfectly well on the previous run. The cost of the narrower rule is
      // that a conversation truncated at the front by the 30-day cleanup
      // reads as complete; `transcript_batches` still shows how many pieces
      // this is built from.
      isIncomplete: CopilotTranscriptGroupingService.hasBatchGap(batches),
      isDesignMode: CopilotTranscriptGroupingService.isDesignModeConversation(activities),
    };
  }

  /**
   * Group rows into conversations and merge their activity lists.
   *
   * Rows arrive in whatever order the pull produced. Batches are applied in
   * numeric order; a row with no batch number sorts last rather than being
   * dropped, because a conversation missing part of itself is still worth
   * showing.
   */
  static groupTranscriptRows(events: NormalizedPullEvent[]): ConversationGroup[] {
    const groups: ConversationGroup[] = [];
    for (const [key, bucket] of CopilotTranscriptGroupingService.bucketRowsByConversation(events)) {
      groups.push(CopilotTranscriptGroupingService.conversationGroupOf({ key, bucket }));
    }

    return groups;
  }
}
