// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { definePipeline } from "~/server/event-sourcing";

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
 */
export function createPulledUsageProcessingPipeline() {
  return definePipeline<PulledUsageProcessingEvent>()
    .withName(PULLED_USAGE_PIPELINE_NAME)
    .withAggregateType(PULLED_USAGE_AGGREGATE_TYPE)
    .withCommand("recordPulledUsage", RecordPulledUsageCommand)
    .build();
}
