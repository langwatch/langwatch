import {
  type ContributeSpanFactsCommandData,
  contributeSpanFactsCommandDataSchema,
  CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
  isStampableContext,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  type SessionWorkingContext,
  type SpanFactsContributedEvent,
} from "@langwatch/coding-agent-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import { MODEL_CALL_SPAN_NAMES } from "../eventing/coding-agent-session-span.projection.ts";
import type { CodingAgentSessionContextMemoRepository } from "../repositories/session-context-memo.repository.ts";

/**
 * Stamps the spans that carry a model call with the session's declared
 * working context, the way the log lane stamps a row-bearing record, so the
 * fold can charge the call's tokens where they were spent. Only reads the
 * memo: the declaration that fills it is a log record.
 */
export class EventingContributeSpanFactsAdapter implements CommandHandler<
  Command<ContributeSpanFactsCommandData>,
  SpanFactsContributedEvent
> {
  constructor(private readonly deps: { contextMemo: CodingAgentSessionContextMemoRepository }) {}

  static create(deps: {
    contextMemo: CodingAgentSessionContextMemoRepository;
  }): EventingContributeSpanFactsAdapter {
    return new EventingContributeSpanFactsAdapter(deps);
  }

  static readonly schema = defineCommandSchema(
    CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
    contributeSpanFactsCommandDataSchema,
    "Contribute one span's coding-agent facts to its session",
  );

  async handle(
    command: Command<ContributeSpanFactsCommandData>,
  ): Promise<SpanFactsContributedEvent[]> {
    const data = await this.stamped(command.data);
    return [
      EventUtils.createEvent<SpanFactsContributedEvent>({
        aggregateType: "coding_agent_session",
        aggregateId: data.sessionId,
        tenantId: createTenantId(command.tenantId),
        type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
        version: SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        // A span contributes to its session exactly once — re-delivered
        // telemetry must not inflate the fold (session-aggregate.feature).
        // Span ids are unique within a trace, not globally, so the trace id
        // stays in the key.
        idempotencyKey: `${command.tenantId}:${data.traceId}:${data.spanId}`,
      }),
    ];
  }

  /**
   * The contribution with the declared context applied when the span carries
   * a model call; every other span passes through untouched, because nothing
   * downstream charges it anywhere. A failed memo read degrades to an
   * unstamped contribution rather than failing it.
   */
  private async stamped(
    data: ContributeSpanFactsCommandData,
  ): Promise<ContributeSpanFactsCommandData> {
    if (!MODEL_CALL_SPAN_NAMES.has(data.name)) return data;

    const context = await this.stampableContext(data);
    if (context === null) return data;

    return {
      ...data,
      repositoryHost: context.repositoryHost,
      repositoryOwner: context.repositoryOwner,
      repositoryName: context.repositoryName,
      branch: context.branch,
    };
  }

  private async stampableContext(
    data: ContributeSpanFactsCommandData,
  ): Promise<SessionWorkingContext | null> {
    try {
      const context = await this.deps.contextMemo.find({
        tenantId: data.tenantId,
        sessionId: data.sessionId,
      });
      if (context === null || !isStampableContext(context)) return null;
      return context;
    } catch {
      return null;
    }
  }

  static getAggregateId(payload: ContributeSpanFactsCommandData): string {
    return payload.sessionId;
  }

  static getSpanAttributes(
    payload: ContributeSpanFactsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.coding_agent.session_id": payload.sessionId,
      "payload.coding_agent.agent": payload.agent,
      "payload.coding_agent.span_name": payload.name,
    };
  }
}
