/**
 * Judge agent wrapper that collects spans remotely before evaluation.
 *
 * The standard judge agent reads spans from an in-memory collector populated
 * by OTEL instrumentation in the same process. For HTTP targets, spans are
 * stored remotely. This wrapper queries the platform API for the trace's spans,
 * populates a JudgeSpanCollector, then delegates to a fresh judge agent instance
 * configured with that collector.
 *
 * The remote query happens inside call() (async) so it runs between the final
 * conversation turn and the actual judge evaluation.
 */

import {
  JudgeAgentAdapter,
  AgentRole,
  judgeAgent,
  type AgentInput,
  type AgentReturnTypes,
  type JudgeAgentConfig,
} from "@langwatch/scenario";
import { createLogger } from "~/utils/logger/server";
import { collectRemoteSpans } from "./remote-span-collector";
import type { SpanQueryFn } from "./types";

const logger = createLogger("RemoteSpanJudgeAgent");

interface RemoteSpanJudgeAgentParams {
  criteria: string[];
  model: JudgeAgentConfig["model"];
  projectId: string;
  querySpans: SpanQueryFn;
  traceId?: string;
  spanCollectionTimeoutMs?: number;
}

/**
 * Judge agent that queries spans remotely before delegating to the standard judge.
 *
 * The trace ID is captured at adapter call time and passed explicitly via
 * `setTraceId()` or the constructor, rather than reading from ambient OTEL context.
 */
export class RemoteSpanJudgeAgent extends JudgeAgentAdapter {
  role = AgentRole.JUDGE;
  criteria: string[];

  private readonly params: RemoteSpanJudgeAgentParams;
  private explicitTraceId: string | undefined;

  constructor(params: RemoteSpanJudgeAgentParams) {
    super();
    this.name = "RemoteSpanJudgeAgent";
    this.criteria = params.criteria;
    this.params = params;
    this.explicitTraceId = params.traceId;
  }

  /** Sets the trace ID captured during HTTP adapter calls. */
  setTraceId(traceId: string): void {
    this.explicitTraceId = traceId;
  }

  async call(input: AgentInput): Promise<AgentReturnTypes> {
    const traceId = this.explicitTraceId;
    const threadId = input.threadId;

    let spanCollector;
    if (traceId) {
      logger.info(
        { traceId, threadId, projectId: this.params.projectId },
        "Collecting remote spans before judge evaluation",
      );

      spanCollector = await collectRemoteSpans({
        traceId,
        projectId: this.params.projectId,
        threadId,
        querySpans: this.params.querySpans,
        timeoutMs: this.params.spanCollectionTimeoutMs,
      });
    } else {
      logger.debug("No trace ID provided, skipping remote span collection");
    }

    // Create a standard judge agent with the collected spans
    const delegate = judgeAgent({
      criteria: this.params.criteria,
      model: this.params.model,
      ...(spanCollector ? { spanCollector } : {}),
    });

    return delegate.call(input);
  }
}
