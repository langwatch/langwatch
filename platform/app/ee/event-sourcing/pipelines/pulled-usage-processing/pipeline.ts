// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  PULLED_USAGE_LEDGER_PROCESS_NAME,
  type PulledUsageLedgerProcessDeps,
  pulledUsageLedgerPM,
} from "@ee/governance/process-manager/pulledUsageLedger.process";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
} from "@langwatch/eventing";

import { RecordPulledUsageCommand } from "./commands";
import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_PIPELINE_NAME,
  PULLED_USAGE_PROCESSING_EVENT_TYPES,
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
 */
export function createPulledUsageProcessingPipeline(
  deps: { ledger?: PulledUsageLedgerProcessDeps } = {},
) {
  const pipeline = definePipeline<PulledUsageProcessingEvent>({
    name: PULLED_USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: PULLED_USAGE_AGGREGATE_TYPE,
      events: defineEvents(PULLED_USAGE_PROCESSING_EVENT_TYPES),
    }),
  }).withCommand("recordPulledUsage", RecordPulledUsageCommand);
  if (!deps.ledger) return pipeline.build();
  return pipeline
    .withProcessManager(
      PULLED_USAGE_LEDGER_PROCESS_NAME,
      pulledUsageLedgerPM(deps.ledger),
    )
    .build();
}
