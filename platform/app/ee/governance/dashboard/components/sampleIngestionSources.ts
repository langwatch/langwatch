// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Source } from "../pages/ingestionSourceForms";
import {
  modeForSourceType,
  sampleSourceTypeOptions,
} from "./ingestionSourceCatalog";

/**
 * The Sources tab in sample mode: one row per source type the catalog offers
 * for illustration, carrying the name the Add source menu gives that type.
 *
 * DERIVED, NEVER RETYPED. These rows used to be built from the sample TOOL
 * cards, so the table named connectors the product does not sell — a "ChatGPT
 * Enterprise" source, a "Custom Agents" source, a "Claude Cowork" source — and
 * a reader who turned sample mode off and opened Add source found none of
 * them under those names. The names, the vendor marks, the protocol chip and
 * the delivery badge now all resolve out of `ingestionSourceCatalog`, the same
 * list the menu reads, so the sample cannot name a source type that is not on
 * offer, cannot rename one that is, and cannot keep showing a retired one.
 *
 * THE MENU AND THIS TABLE ARE NOT THE SAME LIST, and the difference is
 * deliberate. `sampleSourceTypeOptions` is the menu's list minus the types
 * flagged `shouldOmitFromSample` — held back from the mock-up while staying fully on
 * offer. That flag lives on the catalog entry rather than in an exclusion list
 * here, so the reason travels with the type; a bare list of keys in this file
 * would be a second place the two lists could drift apart, which is the exact
 * failure this module was rewritten to close.
 *
 * WHAT IS STILL INVENTED IS THE INSTANCE, not the type: whether this
 * organization's connection is healthy, when data last arrived through it, how
 * often it polls. Those are facts about a connection nobody has made yet, and
 * they are what makes the table read as a fleet rather than as a repeat of the
 * menu. The banner above the page says the whole screen is a mock-up.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The states a connected fleet actually mixes, cycled across the rows in
 * catalog order.
 *
 * Cycled rather than written per source type, because health is not a fact
 * ABOUT a source type — a Genie connector is no likelier to be failing than an
 * OTLP one. The cycle is only long enough to put every badge the table can
 * draw on screen at once: healthy sources at a range of arrival times, one
 * whose last runs all failed (three consecutive failures is what
 * `deriveSourceHealth` calls unhealthy, so that row reads "Pulls failing"), one
 * still waiting for its first event, and one an admin switched off.
 *
 * The one exception the cycle cannot state is below: `errorCount` counts
 * consecutive PULL failures and nothing else writes it, so a push source
 * carrying one would be a state the product cannot produce.
 *
 * INDEXED BY POSITION, so the cycle is coupled to the sampled list: holding a
 * type back or adding one shifts every state after it, and the shift is
 * silent. The badge it can cost is "Pulls failing", whose state has to land on a
 * PULL source or the exception above zeroes it away. Reorder or hold back
 * freely — a test asserts all four badges still reach the screen, and if one
 * goes missing the fix belongs in this cycle rather than in the catalog order.
 */
const SAMPLE_INSTANCE_STATES = [
  { status: "active", errorCount: 0, lastEventAgoMs: 3 * MINUTE_MS },
  { status: "active", errorCount: 0, lastEventAgoMs: 26 * MINUTE_MS },
  { status: "active", errorCount: 0, lastEventAgoMs: 2 * HOUR_MS },
  { status: "active", errorCount: 3, lastEventAgoMs: 31 * HOUR_MS },
  { status: "active", errorCount: 0, lastEventAgoMs: 9 * HOUR_MS },
  { status: "awaiting_first_event", errorCount: 0, lastEventAgoMs: null },
  { status: "active", errorCount: 0, lastEventAgoMs: 47 * MINUTE_MS },
  { status: "disabled", errorCount: 0, lastEventAgoMs: 4 * 24 * HOUR_MS },
] as const;

/**
 * The cadence a scheduled row shows under its protocol chip.
 *
 * A push source has none — nothing polls it — and rendering one would be the
 * sample claiming a control the real drawer does not offer for that type.
 */
function samplePullSchedule(mode: "push" | "pull" | "s3"): string | null {
  if (mode === "push") return null;
  // Hourly for an API pull, once each morning for a file drop: the two
  // cadences the pull adapters actually recommend.
  return mode === "pull" ? "0 * * * *" : "0 6 * * *";
}

/** Fixed so the rows do not drift a day older every time the page is read. */
const SAMPLE_CONNECTED_AT = new Date("2026-06-01T00:00:00Z");

const NOW_MS = Date.now();

export const SAMPLE_INGESTION_SOURCES: Source[] = sampleSourceTypeOptions().map(
  (option, index) => {
    const mode = modeForSourceType({ sourceType: option.value });
    const state =
      SAMPLE_INSTANCE_STATES[index % SAMPLE_INSTANCE_STATES.length]!;
    // Only the puller worker ever writes `errorCount`, so a push source's is
    // always zero. Showing "Pulls failing" over a source nothing polls would be
    // the sample inventing a state the product cannot reach.
    const errorCount = mode === "push" ? 0 : state.errorCount;
    const lastEventAt =
      state.lastEventAgoMs === null
        ? null
        : new Date(NOW_MS - state.lastEventAgoMs);
    return {
      id: `sample-source-${option.value}`,
      organizationId: "sample",
      teamId: null,
      // The catalog's own label. A sample row is not the place to coin a name
      // for a source type, and a name the Add source menu does not use is the
      // one thing this table must never show.
      name: option.label,
      description: null,
      sourceType: option.value,
      parserConfig: {},
      status: state.status,
      errorCount,
      lastSuccessAt: lastEventAt,
      // Unknown, which is what a connection nobody has made has read through
      // to. Naming either answer here would put a collection verdict on a
      // row that has never collected anything.
      lastReadThroughAt: null,
      lastRunCompleteness: null,
      // Left empty on purpose. Health still reads `errorCount`, and a sample
      // row inventing a pull run would put a timestamp on a connection nobody
      // has made.
      pullStatus: {
        lastRunAt: null,
        outcome: null,
        error: null,
        backfillThrough: null,
        hasMore: null,
      },
      lastEventAt,
      traceProjectId: null,
      traceProjectArchived: false,
      archivedAt: null,
      createdAt: SAMPLE_CONNECTED_AT,
      updatedAt: SAMPLE_CONNECTED_AT,
      createdById: null,
      hasPollerCursor: false,
      pullSchedule: samplePullSchedule(mode),
    };
  },
);
