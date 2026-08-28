// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
import { definePipeline } from "~/server/event-sourcing";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";

import { RecordPulledUsageCommand } from "./commands";
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
 * same loop that writes the OCSF audit row.
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
 */
export function createPulledUsageProcessingPipeline(
  deps: {
    ledger?: PulledUsageLedgerProcessDeps;
    costRollupStore?: FoldProjectionStore<GovernanceCostRollupState>;
  } = {},
) {
  let pipeline = definePipeline<PulledUsageProcessingEvent>()
    .withName(PULLED_USAGE_PIPELINE_NAME)
    .withAggregateType(PULLED_USAGE_AGGREGATE_TYPE)
    .withCommand("recordPulledUsage", RecordPulledUsageCommand);
  if (deps.costRollupStore) {
    pipeline = pipeline.withFoldProjection(
      GOVERNANCE_COST_ROLLUP_PROJECTION_NAME,
      new GovernanceCostRollupFoldProjection({ store: deps.costRollupStore }),
    );
  }
  if (!deps.ledger) return pipeline.build();
  return pipeline
    .withProcessManager(
      PULLED_USAGE_LEDGER_PROCESS_NAME,
      pulledUsageLedgerPM(deps.ledger),
    )
    .build();
}
