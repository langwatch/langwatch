import {
  type ContributeLogFactsCommandData,
  contributeLogFactsCommandDataSchema,
  CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  isStampableContext,
  normalizeEventName,
  SESSION_CONTEXT_EVENT,
  type SessionWorkingContext,
  extractWorkingContext,
  type LogFactsContributedEvent,
} from "@langwatch/coding-agent-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import { CodingAgentSessionEventsMapProjection } from "../eventing/coding-agent-session-events.projection.ts";
import type { CodingAgentSessionContextMemoRepository } from "../repositories/session-context-memo.repository.ts";

/** Log facts contribution with stamped context; stamping exclusive to this lane. */
export class EventingContributeLogFactsService implements CommandHandler<
  Command<ContributeLogFactsCommandData>,
  LogFactsContributedEvent
> {
  private constructor(
    private readonly deps: { contextMemo: CodingAgentSessionContextMemoRepository },
  ) {}

  static create(deps: {
    contextMemo: CodingAgentSessionContextMemoRepository;
  }): EventingContributeLogFactsService {
    return new EventingContributeLogFactsService(deps);
  }

  static readonly schema = defineCommandSchema(
    CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
    contributeLogFactsCommandDataSchema,
    "Contribute one log record's coding-agent facts to its session",
  );

  async handle(
    command: Command<ContributeLogFactsCommandData>,
  ): Promise<LogFactsContributedEvent[]> {
    const data = await this.stamped(command.data);
    return [
      EventUtils.createEvent<LogFactsContributedEvent>({
        aggregateType: "coding_agent_session",
        aggregateId: data.sessionId,
        tenantId: createTenantId(command.tenantId),
        type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
        version: LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        // Tenant-scoped like every other command's. A RecordId is a content
        // hash that already includes its tenant, so a collision is not
        // reachable today — but nothing states that invariant at this layer,
        // and a dedup key that silently depends on it would suppress another
        // tenant's work the day it changes.
        idempotencyKey: `${command.tenantId}:${data.recordId}`,
      }),
    ];
  }

  /** Apply working context; memo write idempotent, failures degrade to unstamped row. */
  private async stamped(
    data: ContributeLogFactsCommandData,
  ): Promise<ContributeLogFactsCommandData> {
    const rawName = String(data.facts["event.name"] ?? "");

    if (normalizeEventName(rawName) === SESSION_CONTEXT_EVENT) {
      await this.remember(data);
      return data;
    }

    if (!CodingAgentSessionEventsMapProjection.accepts({ data })) return data;

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

  /**
   * Put a declaration's context in the memo, for the rows that follow it. A
   * declaration naming no repository says nothing to remember, and a memo
   * outage leaves those later rows unstamped rather than failing this one.
   */
  private async remember(data: ContributeLogFactsCommandData): Promise<void> {
    const context = extractWorkingContext(data.facts);
    if (context === null) return;
    try {
      await this.deps.contextMemo.set({
        tenantId: data.tenantId,
        sessionId: data.sessionId,
        context,
      });
    } catch {
      return;
    }
  }

  /**
   * The context this record should be stamped with, or null when there is
   * none to stamp: nothing declared yet, a partial declaration, or a memo
   * that cannot be read.
   */
  private async stampableContext(
    data: ContributeLogFactsCommandData,
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

  static getAggregateId(payload: ContributeLogFactsCommandData): string {
    return payload.sessionId;
  }

  static getSpanAttributes(
    payload: ContributeLogFactsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.coding_agent.session_id": payload.sessionId,
      "payload.coding_agent.agent": payload.agent,
      "payload.coding_agent.record_id": payload.recordId,
    };
  }
}
