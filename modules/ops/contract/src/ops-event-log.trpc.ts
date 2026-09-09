/**
 * The `ops.*` procedures DejaView and the replay wizard call: searching the
 * event log, reading one aggregate's events, recomputing a projection, driving
 * a rebuild, and the anomalies raised alongside them. One of five declarations
 * under `ops` - see `ops-dashboard.trpc.ts` for why there are five.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { opsDismissAnomalyInputSchema } from "./ops-anomaly.ts";
import {
  opsComputeProjectionStateInputSchema,
  opsDiscoverAggregatesInputSchema,
  opsDryRunReplayInputSchema,
  opsGetReplayRunInputSchema,
  opsLoadAggregateEventsInputSchema,
  opsSearchAggregatesInputSchema,
  opsSearchTenantsInputSchema,
  opsStartReplayInputSchema,
} from "./ops-event-log.ts";
import { replayHistoryEntrySchema, replayStatusSchema } from "./ops-replay.ts";
import {
  opsAggregateDiscoverySchema,
  opsAggregateEventsSchema,
  opsAggregateSearchSchema,
  opsAnomalyDismissedSchema,
  opsAnomalyListingSchema,
  opsDryRunReplaySchema,
  opsEventLogSearchWindowSchema,
  opsProjectionStateSchema,
  opsReplayCancelledSchema,
  opsReplayStartedSchema,
  opsTenantSearchSchema,
} from "./ops.responses.ts";

export const opsEventLogTrpc = defineTrpcContract("ops")
  .query("searchAggregates")
  .withInput(opsSearchAggregatesInputSchema)
  .withOutput(opsAggregateSearchSchema)

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

  .query("discoverAggregates")
  .withInput(opsDiscoverAggregatesInputSchema)
  .withOutput(opsAggregateDiscoverySchema)

  .query("searchTenants")
  .withInput(opsSearchTenantsInputSchema)
  .withOutput(opsTenantSearchSchema)

  .mutation("dryRunReplay")
  .withInput(opsDryRunReplayInputSchema)
  .withOutput(opsDryRunReplaySchema)

  .query("getReplayHistory")
  .withInput(z.void())
  .withOutput(replayHistoryEntrySchema.array())

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
