// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  costRollupWatchPM,
} from "@ee/governance/process-manager/costRollupWatch.process";
import {
  PULLED_USAGE_LEDGER_PROCESS_NAME,
  type PulledUsageLedgerProcessDeps,
  pulledUsageLedgerPM,
} from "@ee/governance/process-manager/pulledUsageLedger.process";
import { GOVERNANCE_COST_ROLLUP_PROJECTION_NAME } from "@ee/governance/projections/governanceCostRollup.constants";
import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
} from "@ee/governance/projections/governanceCostRollup.foldProjection";
import type { CostRollupComparatorDayComparer } from "@ee/governance/services/costRollupComparator.service";
import { definePipeline } from "~/server/event-sourcing";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";

import {
  RecordPulledUsageCommand,
  RetractPulledUsageCommand,
} from "./commands";
import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_PIPELINE_NAME,
} from "./schemas/constants";
import type { PulledUsageProcessingEvent } from "./schemas/events";

/**
 * The pulled-usage pipeline (ADR-088).
 *
 * Aggregate: `pulled_usage`, one stream per usage ITEM keyed by its
 * restatement key, so a provider's correction of a period lands behind the
 * figure it corrects instead of beside it.
 *
 * Write surface: `recordPulledUsage`, dispatched from the puller effect in the
 * same loop that writes the OCSF audit row, and `retractPulledUsage`,
 * dispatched by this pipeline's OWN process manager when it recognises that a
 * charge has been reissued into a different rollup cell. The second command is
 * registered unconditionally even though only the process manager sends it: a
 * deployment that drops the ledger dep still has to be able to APPLY a
 * withdrawal that an earlier deployment wrote to the log.
 *
 * Process manager: `pulledUsageLedger` — the sole writer of pulled cost into
 * `gateway_budget_ledger_events`. Optional, and absent it the pipeline still
 * records every observation on the log; only the ledger row is skipped. That
 * matches how the gateway spend pipeline treats its own debits process, and it
 * means a deployment without the ClickHouse ledger degrades to a log rather
 * than to a crash.
 *
 * Projection: `governanceCostRollup` (ADR-128) — the pulled half of the daily
 * cost rollup, and optional on the same terms. The gateway pipeline registers
 * the same fold for its own lane, so a deployment running no pullers at all
 * still summarizes gateway spend; the two lanes are different rows by
 * construction (`CostSource` is in the key) and can never contend.
 *
 * Process manager: `costRollupWatch` (ADR-128) — the drift check, armed by the
 * charges themselves. Mounted only where BOTH the summary store and the
 * comparator exist, because the comparison reads the summary this pipeline's
 * own projection writes: a deployment holding one without the other mounts
 * nothing rather than asking for comparisons that would either die in the
 * outbox five attempts at a time or report success without reading anything.
 */
export function createPulledUsageProcessingPipeline(
  deps: {
    ledger?: PulledUsageLedgerProcessDeps;
    costRollupStore?: FoldProjectionStore<GovernanceCostRollupState>;
    costRollupComparator?: CostRollupComparatorDayComparer;
  } = {},
) {
  let pipeline = definePipeline<PulledUsageProcessingEvent>()
    .withName(PULLED_USAGE_PIPELINE_NAME)
    .withAggregateType(PULLED_USAGE_AGGREGATE_TYPE)
    .withCommand("recordPulledUsage", RecordPulledUsageCommand)
    .withCommand("retractPulledUsage", RetractPulledUsageCommand);
  if (deps.costRollupStore) {
    pipeline = pipeline.withFoldProjection(
      GOVERNANCE_COST_ROLLUP_PROJECTION_NAME,
      new GovernanceCostRollupFoldProjection({ store: deps.costRollupStore }),
    );
  }
  if (deps.ledger) {
    pipeline = pipeline.withProcessManager(
      PULLED_USAGE_LEDGER_PROCESS_NAME,
      pulledUsageLedgerPM(deps.ledger),
    );
  }
  if (deps.costRollupStore && deps.costRollupComparator) {
    pipeline = pipeline.withProcessManager(
      COST_ROLLUP_WATCH_PROCESS_NAME,
      costRollupWatchPM({ comparator: deps.costRollupComparator }),
    );
  }
  return pipeline.build();
}
