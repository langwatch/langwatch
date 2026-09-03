import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  type ContributeLogFactsCommandData,
  contributeLogFactsCommandDataSchema,
} from "@langwatch/coding-agent-contract";
import {
  CONTRIBUTE_LOG_FACTS_COMMAND_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
} from "@langwatch/coding-agent-contract";
import type { LogFactsContributedEvent } from "@langwatch/coding-agent-contract";
import {
  isStampableContext,
  normalizeEventName,
  SESSION_CONTEXT_EVENT,
  type SessionWorkingContext,
  workingContextOfFacts,
} from "@langwatch/coding-agent-contract";
import type { CodingAgentSessionContextMemoPort } from "../ports/coding-agent-session-context.port";
import { CodingAgentSessionEventsMapProjection } from "../projections/coding-agent-session-events.projection";

/**
 * Contributes one log record's facts to its session, stamping row-bearing
 * records with the session's declared working context on the way through.
 *
 * The stamp happens HERE and nowhere later, because this is the one lane with
 * both per-session ordering and the ability to hold state: contributions are
 * keyed per session and drain in order (see the processing adapter), while the
 * map projection that writes the fact table runs per-event on an unordered
 * queue and must stay pure. Stamping the event data before it is appended also
 * makes replays deterministic — a projection rebuild re-reads the same stamped
 * events.
 *
 * A `session_context` declaration updates the memo; every record that becomes
 * a fact-table row reads it. A record processed before its session ever
 * declared goes through unstamped, which the usage read prices under the
 * legacy whole-session rule.
 */
export class EventingContributeLogFactsAdapter implements CommandHandler<
  Command<ContributeLogFactsCommandData>,
  LogFactsContributedEvent
> {
  constructor(private readonly deps: { contextMemo: CodingAgentSessionContextMemoPort }) {}

  static create(deps: {
    contextMemo: CodingAgentSessionContextMemoPort;
  }): EventingContributeLogFactsAdapter {
    return new EventingContributeLogFactsAdapter(deps);
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

  /**
   * The contribution with the working context applied: a declaration writes
   * the memo, a row-bearing record reads it onto the event, and everything
   * else (hooks, plugin loads, body events) passes through untouched.
   *
   * A memo write is idempotent, so a retried command re-writes the same value.
   * Neither a failed read nor a failed write fails the contribution: both
   * degrade to an unstamped row, because attribution is a refinement of the
   * record, not part of it.
   */
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
    const context = workingContextOfFacts(data.facts);
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
