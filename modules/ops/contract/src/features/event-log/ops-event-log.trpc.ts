/**
 * The `ops.*` procedures DejaView and the replay wizard call: search the
 * event log, read one aggregate's events, recompute a projection, drive a
 * rebuild, and the anomalies raised alongside them.
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  opsAggregateEventsSchema,
  opsAnomalyDismissedSchema,
  opsAnomalyListingSchema,
  opsDryRunReplaySchema,
  opsEventLogSearchWindowSchema,
  opsProjectionStateSchema,
  opsReplayCancelledSchema,
  opsReplayStartedSchema,
  opsTenantSearchSchema,
} from "../../ops.responses.ts";
import { opsDismissAnomalyInputSchema } from "../dashboard/ops-anomaly.ts";
import {
  aggregateDiscoveryAnswerSchema,
  aggregateSearchAnswerSchema,
  aggregateSearchRequestedSchema,
  OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE,
  opsComputeProjectionStateInputSchema,
  opsDiscoverAggregatesInputSchema,
  opsDryRunReplayInputSchema,
  opsGetAggregateSearchInputSchema,
  opsGetReplayRunInputSchema,
  opsLoadAggregateEventsInputSchema,
  opsSearchAggregatesInputSchema,
  opsSearchTenantsInputSchema,
  opsStartReplayInputSchema,
} from "./ops-event-log.ts";
import {
  replayHistoryEntrySchema,
  replayHistoryPageInputSchema,
  replayHistoryPageSchema,
  replayStatusSchema,
} from "./ops-replay.ts";

export const opsEventLogTrpc = defineTrpcContract("ops")
  /**
   * Hands an event-log search to a worker, which reads every tenant on its own identity
   * (ADR-202 Decided 14); the answer is the request id `getAggregateSearch` reads.
   */
  .mutation("searchAggregates")
  .withInput(opsSearchAggregatesInputSchema)
  .withOutput(aggregateSearchRequestedSchema)

  /** One search by its request id, refetched when the worker records it completed. */
  .query("getAggregateSearch", { invalidatedBy: [OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE] })
  .withInput(opsGetAggregateSearchInputSchema)
  .withOutput(aggregateSearchAnswerSchema)

  /**
   * The bound on an event-log search: the default lookback the explorer uses
   * and the hot-tier window this deployment is configured with, so the search
   * box can say up front where reads get slower. Cold-tier reads still work.
   */
  .query("getEventLogSearchWindow")
  .withInput(z.void())
  .withOutput(opsEventLogSearchWindowSchema)

  .query("loadAggregateEvents")
  .withInput(opsLoadAggregateEventsInputSchema)
  .withOutput(opsAggregateEventsSchema)

  .query("computeProjectionState")
  .withInput(opsComputeProjectionStateInputSchema)
  .withOutput(opsProjectionStateSchema)

  /**
   * Hands the replay wizard's aggregate count to a worker, which reads every tenant on its own
   * identity (ADR-202 Decided 14); the answer is the request id `getAggregateDiscovery` reads.
   */
  .mutation("discoverAggregates")
  .withInput(opsDiscoverAggregatesInputSchema)
  .withOutput(aggregateSearchRequestedSchema)

  /** One aggregate count by its request id, refetched when the worker records it completed. */
  .query("getAggregateDiscovery", { invalidatedBy: [OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE] })
  .withInput(opsGetAggregateSearchInputSchema)
  .withOutput(aggregateDiscoveryAnswerSchema)

  .query("searchTenants")
  .withInput(opsSearchTenantsInputSchema)
  .withOutput(opsTenantSearchSchema)

  .mutation("dryRunReplay")
  .withInput(opsDryRunReplayInputSchema)
  .withOutput(opsDryRunReplaySchema)

  .query("getReplayHistory")
  .withInput(z.void())
  .withOutput(replayHistoryEntrySchema.array())

  .query("getReplayHistoryPage")
  .withInput(replayHistoryPageInputSchema)
  .withOutput(replayHistoryPageSchema)

  .query("getReplayRun")
  .withInput(opsGetReplayRunInputSchema)
  .withOutput(replayHistoryEntrySchema.nullable())

  .mutation("startReplay")
  .withInput(opsStartReplayInputSchema)
  .withOutput(opsReplayStartedSchema)

  .query("getReplayStatus")
  .withInput(z.void())
  .withOutput(replayStatusSchema)

  .mutation("cancelReplay")
  .withInput(z.void())
  .withOutput(opsReplayCancelledSchema)

  /**
   * The active tenant anomalies - the rate breaker and the structural
   * fingerprint loop - hard tier first.
   */
  .query("listAnomalies")
  .withInput(z.void())
  .withOutput(opsAnomalyListingSchema)

  /**
   * Dismiss an active anomaly by hand. The next detector tick may resurface it
   * if the conditions still hold: this is an operator acknowledgement that
   * stops the badge from blinking, not a fix.
   */
  .mutation("dismissAnomaly")
  .withInput(opsDismissAnomalyInputSchema)
  .withOutput(opsAnomalyDismissedSchema)
  .build();
