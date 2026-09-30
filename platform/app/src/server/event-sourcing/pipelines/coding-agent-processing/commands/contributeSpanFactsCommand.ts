import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type ContributeSpanFactsCommandData,
  contributeSpanFactsCommandDataSchema,
} from "../schemas/commands";
import {
  CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { SpanFactsContributedEvent } from "../schemas/events";
import { MODEL_CALL_SPAN_NAMES } from "../services/coding-agent-session.derivation";
import {
  isStampableContext,
  type SessionContextMemo,
  type SessionWorkingContext,
} from "../services/session-context-memo";

/**
 * Contributes one span's facts to its session, stamping the spans that carry
 * a model call with the session's declared working context on the way
 * through, the same way `ContributeLogFactsCommand` stamps a row-bearing log
 * record. The session fold charges a stamped call's tokens to that context,
 * which is what lets a span-only agent's session (codex reports its tokens on
 * the turn span and contributes no fact row) still say what it spent where.
 *
 * Only reads the memo, never writes it: the declaration that fills it is a
 * log record, so the log lane is where it is remembered. A span processed
 * before its session declared anything, or while the memo cannot be read,
 * goes through unstamped, and the usage read prices those tokens under the
 * legacy whole-session rule.
 */
export class ContributeSpanFactsCommand
  implements
    CommandHandler<
      Command<ContributeSpanFactsCommandData>,
      SpanFactsContributedEvent
    >
{
  static readonly schema = defineCommandSchema(
    CONTRIBUTE_SPAN_FACTS_COMMAND_TYPE,
    contributeSpanFactsCommandDataSchema,
    "Contribute one span's coding-agent facts to its session",
  );

  constructor(private readonly deps: { contextMemo: SessionContextMemo }) {}

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
   * The contribution with the working context applied when the span carries
   * a model call; every other span (tools, spawns, waits) passes through
   * untouched, because nothing downstream charges it anywhere. A failed
   * memo read degrades to an unstamped contribution rather than failing it.
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
      const context = await this.deps.contextMemo.get({
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
