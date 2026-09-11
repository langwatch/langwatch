// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a tenant is paying for in seats, read from its licence list.
 *
 * Conversations say what happened and the Azure bill says what the platform
 * charged; neither can see a licence bought for forty people and used by two.
 * That is the most common governance finding there is, and only the licence
 * list holds it. Microsoft answers this on Microsoft Graph — a third audience
 * and a third sign-in, separate from Dataverse and from Resource Manager.
 *
 * Pure. No I/O, no clock of its own, no fetch — the caller does the talking
 * and hands the reply here, exactly as `azureCostManagement.ts` sits beside
 * `copilotStudioDataverse.puller.ts`. That is what lets every rule below be
 * decided against a real captured reply in a unit test.
 *
 * The classification is the whole of the value, and it was learned from a live
 * run against a real tenant: the naive count said 27 unused seats when the
 * true answer was 2. The 25 came from a company-wide pool nobody can be
 * assigned, and the rest from a free pool that arrives with ten thousand
 * units. Each of those produces a loud, plausible, wrong finding on its own.
 *
 * Two consequences shape everything here:
 *
 *  1. The facts travel INDEPENDENTLY — per-person, live, free, seat-shaped —
 *     rather than as one label. A pool can be free and company-wide and
 *     suspended at once, and the live tenant had pools that were two of those
 *     at the same time. A single label would have to choose, and whichever it
 *     chose would hide the others from anyone reading the record later.
 *
 *  2. EVERY pool is recorded, including the ones nothing counts. A pool
 *     dropped here is a pool no later question can be asked about, and the
 *     reason it was dropped is exactly the reason someone will want to see it.
 *
 * `/v1.0/subscribedSkus` never pages: it returns the tenant's whole list in
 * one reply and documents `$top` as ignored. So there is no page loop here and
 * no next link to follow — unlike the cost read, where paging is real.
 */

import { z } from "zod";
import type { NormalizedPullEvent } from "./pullerAdapter";

/** The audience an app registration signs in for to read the licence list. */
export const MICROSOFT_GRAPH_SCOPE = "https://graph.microsoft.com/.default";

/** The verb these events carry, so a reader can tell them from a conversation. */
export const SEAT_REPORT_ACTION = "seat_report" as const;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a day's licence read may be held before the source moves past it.
 *
 * A week, the same bound `AZURE_COST_MAX_HOLD_MS` draws, for the same reason:
 * a refusal says nothing about how many seats exist, so recording zero for it
 * would be a confident wrong number nothing later corrects. But the licence
 * read needs its own admin consent, and a consent that was never granted is
 * refused identically forever — that is not a late answer, it is no answer,
 * and holding for it would pin every run to a request that cannot succeed.
 *
 * What holding costs here is FREQUENCY, not distance. The cost read's hold
 * widens the window it asks about; the licence read always asks the same
 * single question, but it asks it on every run of the day instead of once.
 * See `nextSeatsCursor` for what giving up therefore has to do.
 */
export const SEATS_MAX_HOLD_MS = 7 * ONE_DAY_MS;

/**
 * The licences that put a Copilot Studio agent, or the Power Platform it runs
 * on, in someone's hands. Matched as a substring of Microsoft's own part
 * number, because Microsoft renames these often and the stem outlives the
 * rename — `POWER_VIRTUAL_AGENTS` became `VIRTUAL_AGENT_USL` and both are
 * still issued.
 */
const SEAT_PART_NUMBER_STEMS = [
  "VIRTUAL_AGENT",
  "POWER_VIRTUAL_AGENTS",
  "CCIBOTS",
  "COPILOT",
  "FLOW",
  "POWERAPPS",
  "POWER_BI",
  "DYN365",
];

/**
 * Licences nobody paid for.
 *
 * Microsoft grants free and self-service licences with an enormous unit count
 * — `FLOW_FREE` arrives with ten thousand — because the number is a cap on how
 * far the licence may spread, not a quantity anyone bought. Counting those
 * units as purchased seats makes every tenant look like it is wasting
 * thousands of licences, which buries the finding that matters: the handful of
 * paid agent seats that really are sitting unused.
 */
const FREE_PART_NUMBER_STEMS = ["FREE", "VIRAL", "TRIAL", "_DEV", "DEVELOPER"];

/**
 * One licence pool, as Graph describes it.
 *
 * Unknown fields are STRIPPED rather than carried: Graph sends `accountId`,
 * `servicePlans`, `lockedOut` and more, none of which any rule here reads, and
 * a record of a tenant's licences is not the place to keep fields nothing
 * asked for.
 */
export const subscribedSkuSchema = z.object({
  skuId: z.string(),
  skuPartNumber: z.string(),
  /** "User" or "Company" — Microsoft's own casing. */
  appliesTo: z.string(),
  /** "Enabled", "Warning", "Suspended", "Deleted" or "LockedOut". */
  capabilityStatus: z.string(),
  /** How many units are assigned to a person right now. */
  consumedUnits: z.number(),
  prepaidUnits: z.object({
    enabled: z.number(),
    suspended: z.number(),
    warning: z.number(),
  }),
});

export type SubscribedSku = z.infer<typeof subscribedSkuSchema>;

/**
 * The reply's envelope.
 *
 * `value` is required, with no default. An HTTP 200 carrying an error body has
 * no `value` at all, and defaulting it to an empty list would turn that into
 * "this tenant holds no licences" — a real-looking answer the caller would
 * mark the day reported on and publish.
 */
const subscribedSkusResponseSchema = z.object({
  value: z.array(z.unknown()),
});

export interface SubscribedSkuRead {
  skus: SubscribedSku[];
  /**
   * Pools that could not be read. Counted rather than dropped silently: a
   * tenant with no licences and a reply nobody could parse look identical on
   * the record, and only one of them is a problem.
   *
   * Never turned into the run's `errorCount`. See the caller — a licence read
   * that reports errors would cost the run its conversations.
   */
  unreadableRows: number;
  /**
   * The whole reply was not the shape this reads — an HTTP 200 carrying an
   * error body, or a contract change.
   *
   * Distinct from an empty `skus`, and the distinction is the point: taken as
   * "this tenant holds nothing" the caller would report the day and publish a
   * tenant with no seats at all.
   */
  malformed: boolean;
}

/**
 * One reply, as the pools it names.
 *
 * There is no page loop and no next link, because `/v1.0/subscribedSkus`
 * returns the whole list in one reply. A pool that cannot be read is counted
 * and stepped over: one bad pool must not cost the tenant the rest of its
 * list, and it must not become the run's error count either, because an error
 * here would discard the conversations the run exists to collect.
 */
export function readSubscribedSkuRows({
  response,
}: {
  response: unknown;
}): SubscribedSkuRead {
  const parsed = subscribedSkusResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { skus: [], unreadableRows: 0, malformed: true };
  }

  const skus: SubscribedSku[] = [];
  let unreadableRows = 0;

  for (const row of parsed.data.value) {
    const sku = subscribedSkuSchema.safeParse(row);
    if (!sku.success) {
      unreadableRows += 1;
      continue;
    }
    skus.push(sku.data);
  }

  return { skus, unreadableRows, malformed: false };
}

/**
 * Whether a licence is something a person can hold.
 *
 * Microsoft says so itself, in `appliesTo`: "User" licences are assigned to
 * people, "Company" licences are held by the tenant and nobody can be given
 * one. A company licence therefore reports zero assigned units forever, and
 * counting its units as bought seats produces the loudest possible false
 * finding — "25 unused agent licences" for a licence that has no seats to
 * leave unused.
 */
function isPerPersonSku(sku: SubscribedSku): boolean {
  return sku.appliesTo.toUpperCase() === "USER";
}

/**
 * Whether the tenant is actually entitled to the licence today.
 *
 * Only "Enabled" and "Warning" are live. Warning is a lapsed licence inside
 * its grace period: the provider's own portal still honours those seats, and a
 * customer a week late on a renewal has not stopped paying for people to sit
 * in them. Suspended, Deleted and LockedOut licences keep their unit numbers
 * on the record long after they stop being anything anyone paid for this
 * month, so counting them inflates both what was bought and what is unused.
 */
function isLiveSku(sku: SubscribedSku): boolean {
  const status = sku.capabilityStatus.toUpperCase();
  return status === "ENABLED" || status === "WARNING";
}

function isFreeSku(partNumber: string): boolean {
  const upper = partNumber.toUpperCase();
  return FREE_PART_NUMBER_STEMS.some((stem) => upper.includes(stem));
}

function isSeatSku(partNumber: string): boolean {
  const upper = partNumber.toUpperCase();
  return SEAT_PART_NUMBER_STEMS.some((stem) => upper.includes(stem));
}

/**
 * How many units of a pool the tenant is paying for.
 *
 * `enabled` plus `warning`, and never `suspended`. Suspension is per unit, not
 * only per pool: a live pool can have a slice of its units frozen, and that
 * slice is not being paid for. The grace-period units are the mirror case —
 * still honoured, still billed, still counted.
 */
function seatsBought(sku: SubscribedSku): number {
  return sku.prepaidUnits.enabled + sku.prepaidUnits.warning;
}

/** The UTC calendar day an instant falls in. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The calendar day a read reports on.
 *
 * The caller needs this to date the events, and it must be the SAME day the
 * watermark is written in and the same day the identity is keyed on — a run
 * that dated its events in one day and moved its watermark in another would
 * re-ask about a day it had just written. So there is one definition of today
 * here rather than a second one at the call site, which is the whole reason
 * this is exported and `utcDay` is not.
 */
export function seatsReportDay({ nowMs }: { nowMs: number }): string {
  return utcDay(nowMs);
}

/**
 * Whether this run should ask about licences at all.
 *
 * Once a day. A licence count moves on procurement's timescale, not the log's,
 * so asking on every run would spend a request an hour to learn nothing.
 *
 * "Once a day" is a property of the KEPT position and needs no state of its
 * own: a run whose position was thrown away has reported nothing, so the next
 * run asks again. That re-read is safe because the identity a pool is recorded
 * under is stable for the day — see `microsoftSeatEvents`.
 */
export function seatsReadIsDue({
  nowMs,
  reportedThroughDay,
}: {
  nowMs: number;
  /** The last day a previous run reported, or null on a first read. */
  reportedThroughDay: string | null;
}): boolean {
  return reportedThroughDay === null || reportedThroughDay < utcDay(nowMs);
}

/**
 * The pools a read found, as the events the run hands back.
 *
 * One event per pool, for EVERY pool — the record holds what the tenant
 * actually has, and the classification travels beside it as facts rather than
 * deciding what survives. A pool dropped here is a pool no later question can
 * be asked about, and the reason it was dropped is exactly the reason someone
 * will want to see it.
 *
 * The identity is the pool and the day, never the counts. Two reads of the
 * same day produce the same `source_event_id`, which is what makes the second
 * read land ON the first rather than beside it and double the tenant's seats.
 *
 * No money is reported. What the seats cost is on the invoice the cost read
 * already records, and a figure invented from a unit count here would be added
 * to it — the customer would be shown their spend twice.
 */
export function microsoftSeatEvents({
  skus,
  day,
}: {
  skus: SubscribedSku[];
  /** The calendar day being reported on, `YYYY-MM-DD` in UTC. */
  day: string;
}): NormalizedPullEvent[] {
  return skus.map((sku) => ({
    source_event_id: `msgraph_seats:${sku.skuId}:${day}`,
    // The day the count belongs to, not the instant it was read. A re-read of
    // this day keeps this timestamp unchanged.
    event_timestamp: `${day}T00:00:00.000Z`,
    // A licence pool names no person, and inventing one would attribute the
    // tenant's whole procurement to whoever happened to be configured.
    actor: "",
    action: SEAT_REPORT_ACTION,
    target: sku.skuPartNumber,
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(sku),
    extra: {
      skuId: sku.skuId,
      skuPartNumber: sku.skuPartNumber,
      appliesTo: sku.appliesTo,
      capabilityStatus: sku.capabilityStatus,
      // Native numbers and booleans: the whole OCSF row is serialised as one
      // JSON document, which keeps them, and every reader would otherwise
      // have to re-parse "27" and string-compare "true" forever — an event
      // shape, once written, is the one shape history has.
      seatsBought: seatsBought(sku),
      seatsAssigned: sku.consumedUnits,
      // Four independent facts, not one label: a pool can be free and
      // company-wide and suspended at once, and a label would have to pick.
      perPerson: isPerPersonSku(sku),
      live: isLiveSku(sku),
      free: isFreeSku(sku.skuPartNumber),
      seatStem: isSeatSku(sku.skuPartNumber),
    },
  }));
}

/**
 * Where the licence read stands after a run, for the next run to pick up.
 *
 * Three outcomes, the same three `nextAzureCostCursor` draws. A day REPORTED
 * moves the mark to today. A day HELD — refused, unreachable, throttled —
 * moves nothing, so the next run asks again: being refused says nothing about
 * how many seats exist, and a zero would be a confident wrong number that a
 * summary would faithfully honour. A day held past the cap is GIVEN UP.
 *
 * The hold instant is set once and carried, never refreshed on each failure:
 * refreshing it would put the cap permanently out of reach.
 *
 * Giving up marks TODAY reported, which is the only thing that stops the
 * asking — every later run today then finds nothing due and makes no request.
 * It is a small lie about a day whose seats are unknown, and it costs that day
 * its seat figure, which is what the day had before any of this existed.
 *
 * And the hold instant is KEPT through the give-up rather than cleared, which
 * is where this parts company with the cost cursor. The cost read clears it
 * because moving its watermark forward has already bounded the ask; here there
 * is no window to bound, so clearing would open a fresh week in which every
 * run asks again — reinstating exactly the cost the cap exists to stop.
 * Keeping it means tomorrow's day-roll retries once, gives up again
 * immediately, and a consent that was never granted costs one request a day
 * forever. A consent that IS granted takes the source straight back out: the
 * daily retry succeeds, `reported` clears the hold, and nothing is lost.
 */
export function nextSeatsCursor({
  nowMs,
  previous,
  outcome,
}: {
  nowMs: number;
  previous: { reportedThroughDay: string | null; heldSinceMs: number | null };
  outcome: "reported" | "held";
}): { reportedThroughDay: string | null; heldSinceMs: number | null } {
  if (outcome === "reported") {
    return { reportedThroughDay: utcDay(nowMs), heldSinceMs: null };
  }

  const heldSinceMs = previous.heldSinceMs ?? nowMs;
  if (nowMs - heldSinceMs <= SEATS_MAX_HOLD_MS) {
    return { reportedThroughDay: previous.reportedThroughDay, heldSinceMs };
  }

  return { reportedThroughDay: utcDay(nowMs), heldSinceMs };
}
