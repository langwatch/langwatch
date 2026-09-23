import { type TenantId } from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";

import type { LangyConversationCommands } from "../app/langy.members.ts";
import { LANGY_ID_RESOURCES } from "../eventing/langy-conversation-process.schemas.ts";
import type { LangyConversationProcessingEvent } from "../eventing/langy-conversation-state.projection.ts";
import type { LangyConversationRepository } from "../repositories/langy-conversation-projection.repository.ts";
import {
  type LangyMessageRepository,
  NullLangyMessageRepository,
} from "../repositories/langy-message.repository.ts";
import { LangyFinalPartsService } from "./langy-final-parts.service.ts";
import type { LangyTurnOrderReader } from "./langy-turn-order.service.ts";

export type { LangyConversationRepository as LangyConversationReadRepository } from "../repositories/langy-conversation-projection.repository.ts";

import type { LangyUsageCount } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import { LangyConversationLifecycleService } from "./langy-conversation-lifecycle.service.ts";
import { LangyConversationReadService } from "./langy-conversation-read.service.ts";
import { LangyConversationTurnService } from "./langy-conversation-turn.service.ts";

/**
 * Narrow read port over the canonical event log (ADR-059), satisfied by
 * `EventStore.getEventsOccurredSince`. The explicit lower bound lets
 * ClickHouse prune weekly partitions instead of cold-scanning the history.
 */
export interface LangyConversationEventsReader {
  getEventsOccurredSince(
    aggregateId: string,
    context: { tenantId: TenantId },
    aggregateType: "langy_conversation",
    occurredAtFromMs: number,
  ): Promise<readonly LangyConversationProcessingEvent[]>;
}

export interface LangyConversationRuntime {
  now(): number;
  generateId(resource: keyof typeof LANGY_ID_RESOURCES): string;
  createTurnId(): string;
}

const defaultRuntime: LangyConversationRuntime = {
  now: () => nowInstant().epochMilliseconds,
  generateId: (resource) => generate(LANGY_ID_RESOURCES[resource]).toString(),
  createTurnId: () => crypto.randomUUID(),
};

/**
 * Shape gate for ADOPTED conversation ids (`ensureConversation` with
 * `adoptUnknownId`): caller-chosen ids become aggregate keys, so they must fit
 * our KSUID-prefixed alphabet — a scenario `threadId` fits.
 */
export const ADOPTABLE_CONVERSATION_ID = /^[A-Za-z0-9_-]{6,120}$/;

/** Everything one conversation's local control left on the record. */

/**
 * Langy application service. Reads come from the Postgres operational
 * projection; writes remain event-sourcing commands. The read, turn and
 * lifecycle collaborators below each own one of those jobs.
 */
export class LangyConversationService {
  private readonly repository: LangyConversationRepository;
  private readonly commands: LangyConversationCommands;
  private readonly messages: LangyMessageRepository;
  private readonly events: LangyConversationEventsReader | null;
  private readonly finalParts: LangyFinalPartsService;
  private readonly runtime: LangyConversationRuntime;
  private readonly turnOrder: LangyTurnOrderReader | null;

  private constructor({
    repository,
    commands,
    messages = new NullLangyMessageRepository(),
    events = null,
    finalParts = LangyFinalPartsService.create(),
    runtime = defaultRuntime,
    turnOrder = null,
  }: {
    repository: LangyConversationRepository;
    commands: LangyConversationCommands;
    messages?: LangyMessageRepository;
    events?: LangyConversationEventsReader | null;
    finalParts?: LangyFinalPartsService;
    runtime?: LangyConversationRuntime;
    turnOrder?: LangyTurnOrderReader | null;
  }) {
    this.repository = repository;
    this.commands = commands;
    this.messages = messages;
    this.events = events;
    this.finalParts = finalParts;
    this.runtime = runtime;
    this.turnOrder = turnOrder;
    this.reads = LangyConversationReadService.create({ repository, events });
    this.turns = LangyConversationTurnService.create({
      repository,
      commands,
      finalParts,
      runtime,
      turnOrder,
    });
    this.lifecycle = LangyConversationLifecycleService.create({
      repository,
      commands,
      messages,
      runtime,
      getById: (input) => this.getById(input),
      findByIdVisible: (input) => this.findByIdVisible(input),
    });
  }

  private readonly reads: LangyConversationReadService;

  private readonly turns: LangyConversationTurnService;

  private readonly lifecycle: LangyConversationLifecycleService;

  getById(
    input: Parameters<LangyConversationReadService["getById"]>[0],
  ): ReturnType<LangyConversationReadService["getById"]> {
    return this.reads.getById(input);
  }

  getEventsAfter(
    input: Parameters<LangyConversationReadService["getEventsAfter"]>[0],
  ): ReturnType<LangyConversationReadService["getEventsAfter"]> {
    return this.reads.getEventsAfter(input);
  }

  getLocalRecord(
    input: Parameters<LangyConversationReadService["getLocalRecord"]>[0],
  ): ReturnType<LangyConversationReadService["getLocalRecord"]> {
    return this.reads.getLocalRecord(input);
  }

  findByIdVisible(
    input: Parameters<LangyConversationReadService["findByIdVisible"]>[0],
  ): ReturnType<LangyConversationReadService["findByIdVisible"]> {
    return this.reads.findByIdVisible(input);
  }

  getAll(
    input: Parameters<LangyConversationReadService["getAll"]>[0],
  ): ReturnType<LangyConversationReadService["getAll"]> {
    return this.reads.getAll(input);
  }

  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<LangyUsageCount> {
    return this.repository.countUsage(input);
  }

  getPage(
    input: Parameters<LangyConversationReadService["getPage"]>[0],
  ): ReturnType<LangyConversationReadService["getPage"]> {
    return this.reads.getPage(input);
  }

  ensureConversation(
    input: Parameters<LangyConversationLifecycleService["ensureConversation"]>[0],
  ): ReturnType<LangyConversationLifecycleService["ensureConversation"]> {
    return this.lifecycle.ensureConversation(input);
  }

  createConversation(
    input: Parameters<LangyConversationLifecycleService["createConversation"]>[0],
  ): ReturnType<LangyConversationLifecycleService["createConversation"]> {
    return this.lifecycle.createConversation(input);
  }

  forkById(
    input: Parameters<LangyConversationLifecycleService["forkById"]>[0],
  ): ReturnType<LangyConversationLifecycleService["forkById"]> {
    return this.lifecycle.forkById(input);
  }

  findRunToken(
    input: Parameters<LangyConversationLifecycleService["findRunToken"]>[0],
  ): ReturnType<LangyConversationLifecycleService["findRunToken"]> {
    return this.lifecycle.findRunToken(input);
  }

  recordUserMessage(
    input: Parameters<LangyConversationTurnService["recordUserMessage"]>[0],
  ): ReturnType<LangyConversationTurnService["recordUserMessage"]> {
    return this.turns.recordUserMessage(input);
  }

  acceptTurn(
    input: Parameters<LangyConversationTurnService["acceptTurn"]>[0],
  ): ReturnType<LangyConversationTurnService["acceptTurn"]> {
    return this.turns.acceptTurn(input);
  }

  recordToolCallStarted(
    input: Parameters<LangyConversationTurnService["recordToolCallStarted"]>[0],
  ): ReturnType<LangyConversationTurnService["recordToolCallStarted"]> {
    return this.turns.recordToolCallStarted(input);
  }

  recordToolCallCompleted(
    input: Parameters<LangyConversationTurnService["recordToolCallCompleted"]>[0],
  ): ReturnType<LangyConversationTurnService["recordToolCallCompleted"]> {
    return this.turns.recordToolCallCompleted(input);
  }

  recordPlanUpdated(
    input: Parameters<LangyConversationTurnService["recordPlanUpdated"]>[0],
  ): ReturnType<LangyConversationTurnService["recordPlanUpdated"]> {
    return this.turns.recordPlanUpdated(input);
  }

  failTurn(
    input: Parameters<LangyConversationTurnService["failTurn"]>[0],
  ): ReturnType<LangyConversationTurnService["failTurn"]> {
    return this.turns.failTurn(input);
  }

  turnExists(
    input: Parameters<LangyConversationTurnService["turnExists"]>[0],
  ): ReturnType<LangyConversationTurnService["turnExists"]> {
    return this.turns.turnExists(input);
  }

  ingestAgentTurnResult(
    input: Parameters<LangyConversationTurnService["ingestAgentTurnResult"]>[0],
  ): ReturnType<LangyConversationTurnService["ingestAgentTurnResult"]> {
    return this.turns.ingestAgentTurnResult(input);
  }

  findPendingHandoff(
    input: Parameters<LangyConversationTurnService["findPendingHandoff"]>[0],
  ): ReturnType<LangyConversationTurnService["findPendingHandoff"]> {
    return this.turns.findPendingHandoff(input);
  }

  recordTurnHandoff(
    input: Parameters<LangyConversationTurnService["recordTurnHandoff"]>[0],
  ): ReturnType<LangyConversationTurnService["recordTurnHandoff"]> {
    return this.turns.recordTurnHandoff(input);
  }

  consumeHandoff(
    input: Parameters<LangyConversationTurnService["consumeHandoff"]>[0],
  ): ReturnType<LangyConversationTurnService["consumeHandoff"]> {
    return this.turns.consumeHandoff(input);
  }

  finalizeTurn(
    input: Parameters<LangyConversationTurnService["finalizeTurn"]>[0],
  ): ReturnType<LangyConversationTurnService["finalizeTurn"]> {
    return this.turns.finalizeTurn(input);
  }

  deleteById(
    input: Parameters<LangyConversationLifecycleService["deleteById"]>[0],
  ): ReturnType<LangyConversationLifecycleService["deleteById"]> {
    return this.lifecycle.deleteById(input);
  }

  updateById(
    input: Parameters<LangyConversationLifecycleService["updateById"]>[0],
  ): ReturnType<LangyConversationLifecycleService["updateById"]> {
    return this.lifecycle.updateById(input);
  }

  clearAllForUser(
    input: Parameters<LangyConversationLifecycleService["clearAllForUser"]>[0],
  ): ReturnType<LangyConversationLifecycleService["clearAllForUser"]> {
    return this.lifecycle.clearAllForUser(input);
  }

  static create(
    commands: LangyConversationCommands,
    repository: LangyConversationRepository,
    messages?: LangyMessageRepository,
    events?: LangyConversationEventsReader | null,
    finalParts?: LangyFinalPartsService,
    runtime?: LangyConversationRuntime,
    turnOrder?: LangyTurnOrderReader | null,
  ): LangyConversationService {
    return new LangyConversationService({
      repository,
      commands,
      messages,
      events,
      finalParts,
      runtime,
      turnOrder,
    });
  }
}
