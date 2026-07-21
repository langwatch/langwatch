import { definePipeline } from "../..";
import { ContributeLogFactsCommand } from "./commands/contributeLogFactsCommand";
import { ContributeMetricFactsCommand } from "./commands/contributeMetricFactsCommand";
import { ContributeSpanFactsCommand } from "./commands/contributeSpanFactsCommand";
import type { CodingAgentProcessingEvent } from "./schemas/events";

/**
 * The coding-agent pipeline (ADR-056).
 *
 * Aggregate: `coding_agent_session` — aggregateId is the tenant-scoped
 * provider session key (`session.id` / `gen_ai.conversation.id`, normalized),
 * or the trace id when the telemetry carried no session key.
 *
 * Write surface — one contribution command per OTLP signal, dispatched by the
 * source pipelines (the durable cross-pipeline bridge ADR-055 established):
 * - contributeSpanFacts:   span ingestion → tool/model-call facts
 * - contributeLogFacts:    log-processing → the lifted scalar vocabulary
 * - contributeMetricFacts: metric-processing → converged per-series totals
 *
 * Consumption is subscribers + projections + one process manager — no
 * reactors (ADR-056 §3). Projections and the process manager mount in later
 * slices; commands default to per-aggregate grouping, so one session's
 * contributions apply in order.
 */
export function createCodingAgentProcessingPipeline() {
  return definePipeline<CodingAgentProcessingEvent>()
    .withName("coding_agent_processing")
    .withAggregateType("coding_agent_session")
    .withCommand("contributeSpanFacts", ContributeSpanFactsCommand)
    .withCommand("contributeLogFacts", ContributeLogFactsCommand)
    .withCommand("contributeMetricFacts", ContributeMetricFactsCommand)
    .build();
}
