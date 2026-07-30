import type { CanonicalLogRecordRepository } from "~/server/app-layer/logs/repositories/canonical-log-record.repository";
import { definePipeline } from "../..";
import type { CommandBus } from "../../commands/commandBus";
import { ContributeLogFactsCommand } from "../coding-agent-processing/commands/contributeLogFactsCommand";
import { createCodingAgentLogFactsDispatchSubscriber } from "../coding-agent-processing/subscribers/codingAgentLogFactsDispatch.subscriber";
import { logCommandGroupKey } from "./canonicalLog";
import { RecordCanonicalLogCommand } from "./commands/recordCanonicalLogCommand";
import { CanonicalLogStorageMapProjection } from "./projections/canonicalLogStorage.mapProjection";
import { CanonicalLogAppendStore } from "./projections/stores";
import type { LogProcessingEvent } from "./schemas/events";

/**
 * ADR-102 — nothing here is a value the builder registers. The append
 * store is constructed from the repository it wraps, and the coding-agent
 * dispatch subscriber from its imported factory over a command-bus port.
 */
export interface LogProcessingPipelineDeps {
  canonicalLogRecordRepository: CanonicalLogRecordRepository;
  logCommandShardCount: number;
  /** ADR-102 — identity-keyed dispatch into other pipelines' commands. */
  commands: CommandBus;
}

export function createLogProcessingPipeline(deps: LogProcessingPipelineDeps) {
  const shardCount = deps.logCommandShardCount;

  return definePipeline<LogProcessingEvent>()
    .withName("log_processing")
    .withAggregateType("log")
    .withMapProjection(
      "canonicalLogStorage",
      new CanonicalLogStorageMapProjection({
        store: new CanonicalLogAppendStore(deps.canonicalLogRecordRepository),
        shardCount,
      }),
    )
    // Cross-pipeline dispatch (ADR-105): coding-agent log facts. The port
    // binds now and resolves on first dispatch, so coding-agent registration
    // order relative to this pipeline carries no meaning.
    .withEventSubscriber(
      "codingAgentLogFactsDispatch",
      createCodingAgentLogFactsDispatchSubscriber({
        contributeLogFacts: deps.commands.port(ContributeLogFactsCommand),
      }),
    )
    .withCommand("recordLogRecord", RecordCanonicalLogCommand, {
      getGroupKey: (payload) =>
        logCommandGroupKey(payload.recordId, shardCount),
    })
    .build();
}
