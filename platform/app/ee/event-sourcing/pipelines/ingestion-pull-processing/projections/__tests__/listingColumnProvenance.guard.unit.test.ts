import { describe, expect, it } from "vitest";

import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusFoldProjection,
} from "../ingestionPullRunStatus.foldProjection";

/**
 * Who is allowed to write the listing columns.
 *
 * There is already a guard on where the withheld count may GO -- it watches
 * the sinks, and fails if the number reaches a telemetry span or any other
 * reader that has no business with it. This guard watches the opposite end:
 * who put a value in the column in the first place.
 *
 * Both are needed, and neither substitutes for the other. A sink guard cannot
 * tell a legitimate write from an illegitimate one, because by the time the
 * value is in the row they look identical -- same column, same type, same
 * shape. If a handler that has nothing to do with listings were to start
 * writing `LastPeopleWithheldCount`, the sink guard would stay green, because
 * the value would be going exactly where a withheld count is supposed to go.
 * It would just be a number that no listing produced, which is worse than a
 * leak: a leak is a true fact in the wrong place, and this would be a false
 * fact in the right one.
 *
 * So the rule is provenance, not destination. Eleven columns describe what a
 * listing answered. Only the four handlers that fold a listing event may
 * write them. Every other handler must leave them exactly as it found them.
 *
 * The handler list below is checked against the class rather than trusted, so
 * a handler added later cannot quietly fall outside the rule -- it fails the
 * first test until someone classifies it, and classifying it as non-listing
 * immediately subjects it to the second.
 */

const LISTING_COLUMNS = [
  "LastAgentsListingAt",
  "LastAgentsListingOutcome",
  "LastAgentsListingCount",
  "LastAgentsListingReason",
  "LastAgentsListingStatus",
  "LastPeopleListingAt",
  "LastPeopleListingOutcome",
  "LastPeopleDirectoryCount",
  "LastPeopleWithheldCount",
  "LastPeopleListingReason",
  "LastPeopleListingStatus",
] as const satisfies readonly (keyof IngestionPullRunStatusData)[];

/** The only handlers permitted to write the columns above. */
const LISTING_HANDLERS = [
  "handleIngestionPullAgentsListed",
  "handleIngestionPullAgentsListingRefused",
  "handleIngestionPullPeopleListed",
  "handleIngestionPullPeopleListingRefused",
] as const;

/** Everything else the projection folds. None of these may touch them. */
const NON_LISTING_HANDLERS = [
  "handleIngestionPullConfigured",
  "handleIngestionPullDisabled",
  "handleIngestionPullRunCompleted",
  "handleIngestionPullRunFailed",
] as const;

const projection = new IngestionPullRunStatusFoldProjection({
  store: {
    load: async () => null,
    store: async () => undefined,
  } as StateProjectionStore<IngestionPullRunStatusData>,
});

/**
 * A state whose listing columns all hold a distinctive value, so that a
 * handler clearing one to null is caught as loudly as one overwriting it.
 * Starting from `init()` rather than a literal means a column added to the
 * projection later still gets a real starting value here.
 */
function stateWithListingsRecorded(): IngestionPullRunStatusData {
  return {
    ...projection.init(),
    LastAgentsListingAt: 111,
    LastAgentsListingOutcome: "listed",
    LastAgentsListingCount: 7,
    LastAgentsListingReason: null,
    LastAgentsListingStatus: null,
    LastPeopleListingAt: 222,
    LastPeopleListingOutcome: "refused",
    LastPeopleDirectoryCount: 500,
    LastPeopleWithheldCount: 12,
    LastPeopleListingReason: "insufficient_scope",
    LastPeopleListingStatus: 403,
  };
}

/**
 * One event carrying every field any of the four non-listing handlers reads.
 * A single object is deliberate: the question is whether a handler writes the
 * listing columns, and giving each handler its own realistic event would add
 * fixture surface without changing the answer.
 */
function eventForAnyHandler(): unknown {
  return {
    id: "event-provenance",
    aggregateId: "source-1",
    aggregateType: "ingestion_pull",
    tenantId: "gov-project",
    createdAt: 9_000,
    occurredAt: 9_000,
    version: "2026-07-17",
    type: "lw.obs.ingestion_pull.run_completed",
    data: {
      sourceId: "source-1",
      cron: "*/15 * * * *",
      configVersion: "v1",
      cursor: "cursor-1",
      nextCursor: "cursor-2",
      runId: "run-1",
      scheduledFor: 8_000,
      eventCount: 3,
      error: "boom",
      errorCode: "provider_unavailable",
      readThroughAt: 8_500,
      completeness: "complete",
    },
  };
}

function listingColumnsOf(
  state: IngestionPullRunStatusData,
): Record<string, unknown> {
  return Object.fromEntries(
    LISTING_COLUMNS.map((column) => [column, state[column]]),
  );
}

describe("listing column provenance", () => {
  it("classifies every handler the projection actually has", () => {
    const declared = [...LISTING_HANDLERS, ...NON_LISTING_HANDLERS].sort();

    const actual = Object.getOwnPropertyNames(
      IngestionPullRunStatusFoldProjection.prototype,
    )
      .filter((name) => name.startsWith("handle"))
      .sort();

    // Read off the class, never a hand-written list, so a fifth handler
    // arriving tomorrow fails here rather than silently sitting outside the
    // rule. If this test is what went red, the fix is to decide which of the
    // two lists above the new handler belongs in -- not to widen the filter.
    expect(actual).toEqual(declared);
  });

  it.each(
    NON_LISTING_HANDLERS,
  )("%s leaves every listing column untouched", (handlerName) => {
    const before = stateWithListingsRecorded();

    const handler = (
      projection as unknown as Record<
        string,
        | ((event: unknown, state: IngestionPullRunStatusData) => unknown)
        | undefined
      >
    )[handlerName];

    // Thrown rather than asserted, because an `expect` here would record a
    // failure and then let the call below run anyway. The first test already
    // proves the name exists; this is the guard against reaching that call
    // with nothing to call.
    if (typeof handler !== "function") {
      throw new Error(`${handlerName} is not a method on the projection`);
    }

    // Called on the instance, so a handler that consults `this` -- the
    // failure handler checks whether the run was superseded -- behaves as it
    // does in the fold rather than throwing on an unbound call.
    const after = handler.call(
      projection,
      eventForAnyHandler(),
      before,
    ) as IngestionPullRunStatusData;

    expect(listingColumnsOf(after)).toEqual(listingColumnsOf(before));
  });
});
