import type { CommandEnvelope } from "@langwatch/eventing";
import { type TenantId } from "@langwatch/eventing";
import type { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type {
  LangyAgentRespondedEventData,
  LangyAgentResponseFailedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyConversationArchivedEventData,
  LangyConversationForkedEventData,
  LangyConversationHandoffConsumedEventData,
  LangyConversationHandoffPendingEventData,
  LangyConversationMetadataUpdatedEventData,
  LangyConversationStartedEventData,
  LangyConversationTitleGeneratedEventData,
  LangyLocalControlRequestedEventData,
  LangyLocalPolicyChangedEventData,
  LangyLocalWorkspaceConnectedEventData,
  LangyLocalWorkspaceDisconnectedEventData,
  LangyMessageImportedEventData,
  LangyMessageRecordedEventData,
  LangyPlanUpdatedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
  LangyUserWaitEndedEventData,
  LangyUserWaitStartedEventData,
} from "@langwatch/langy-contract";
import {} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { LangyTurnErrors } from "@langwatch/langy-contract";
import { mintRunToken } from "../ports/langy-frame-auth.port.ts";
import type { LangyConversationProcessingEvent } from "../projections/langy-conversation-state.projection.ts";
import { LANGY_ID_RESOURCES } from "../ports/langy-ids.port.ts";
import {} from "@langwatch/langy-contract";
import { LangyFinalPartsService, type LangyFinalToolCall } from "./langy-final-parts.service.ts";
import type { LangyConversationRepository } from "../repositories/langy-conversation-projection.repository.ts";
import {
  type LangyMessageRepository,
  NullLangyMessageRepository,
} from "../repositories/langy-message.repository.ts";
import type { LangyTurnOrderReader, LangyTurnSegment } from "./langy-turn-order.service.ts";

export type { LangyConversationRepository as LangyConversationReadRepository } from "../repositories/langy-conversation-projection.repository.ts";

import {} from "../rules/langy-conversation-shape.rules.ts";
import { LangyConversationReadService } from "./langy-conversation-read.service.ts";
import { LangyConversationTurnService } from "./langy-conversation-turn.service.ts";
import { LangyConversationLifecycleService } from "./langy-conversation-lifecycle.service.ts";
import { nowInstant } from "@langwatch/time";

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

/** Command dispatchers injected from the event-sourcing pipeline registry. */
type Dispatch<T> = (data: T & CommandEnvelope) => Promise<void>;

export interface LangyConversationCommands {
  createConversation: Dispatch<LangyConversationStartedEventData>;
  forkConversation: Dispatch<LangyConversationForkedEventData>;
  recordMessage: Dispatch<LangyMessageRecordedEventData>;
  importMessage: Dispatch<LangyMessageImportedEventData>;
  acceptAgentTurn: Dispatch<
    LangyAgentTurnAcceptedEventData & {
      conversationStart?: Omit<LangyConversationStartedEventData, "conversationId">;
      userMessage?: Omit<LangyMessageRecordedEventData, "conversationId">;
      consumeHandoffTurnId?: string;
    }
  >;
  initiateToolCall: Dispatch<LangyToolCallInitiatedEventData>;
  succeedToolCall: Dispatch<LangyToolCallSucceededEventData>;
  failToolCall: Dispatch<LangyToolCallFailedEventData>;
  updatePlan: Dispatch<LangyPlanUpdatedEventData>;
  failAgentResponse: Dispatch<LangyAgentResponseFailedEventData>;
  recordAgentResponse: Dispatch<LangyAgentRespondedEventData>;
  archiveConversation: Dispatch<LangyConversationArchivedEventData>;
  updateConversationMetadata: Dispatch<LangyConversationMetadataUpdatedEventData>;
  recordTurnHandoff: Dispatch<LangyConversationHandoffPendingEventData>;
  consumeTurnHandoff: Dispatch<LangyConversationHandoffConsumedEventData>;
  generateConversationTitle: Dispatch<LangyConversationTitleGeneratedEventData>;
  // ADR-129 local control: the shared folder and the cards that wait for the
  // developer. Written by the local control services, folded by the spine and
  // the turn document.
  requestLocalControl: Dispatch<LangyLocalControlRequestedEventData>;
  connectLocalWorkspace: Dispatch<LangyLocalWorkspaceConnectedEventData>;
  disconnectLocalWorkspace: Dispatch<LangyLocalWorkspaceDisconnectedEventData>;
  changeLocalPolicy: Dispatch<LangyLocalPolicyChangedEventData>;
  startUserWait: Dispatch<LangyUserWaitStartedEventData>;
  endUserWait: Dispatch<LangyUserWaitEndedEventData>;
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
  private constructor(
    private readonly repository: LangyConversationRepository,
    private readonly commands: LangyConversationCommands,
    private readonly messages: LangyMessageRepository = new NullLangyMessageRepository(),
    private readonly events: LangyConversationEventsReader | null = null,
    private readonly finalParts: LangyFinalPartsService = LangyFinalPartsService.create(),
    private readonly runtime: LangyConversationRuntime = defaultRuntime,
    private readonly turnOrder: LangyTurnOrderReader | null = null,
  ) {
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
      tryFindByIdVisible: (input) => this.tryFindByIdVisible(input),
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

  tryFindByIdVisible(
    input: Parameters<LangyConversationReadService["tryFindByIdVisible"]>[0],
  ): ReturnType<LangyConversationReadService["tryFindByIdVisible"]> {
    return this.reads.tryFindByIdVisible(input);
  }

  getAll(
    input: Parameters<LangyConversationReadService["getAll"]>[0],
  ): ReturnType<LangyConversationReadService["getAll"]> {
    return this.reads.getAll(input);
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

  tryGetRunToken(
    input: Parameters<LangyConversationLifecycleService["tryGetRunToken"]>[0],
  ): ReturnType<LangyConversationLifecycleService["tryGetRunToken"]> {
    return this.lifecycle.tryGetRunToken(input);
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

  tryGetPendingHandoff(
    input: Parameters<LangyConversationTurnService["tryGetPendingHandoff"]>[0],
  ): ReturnType<LangyConversationTurnService["tryGetPendingHandoff"]> {
    return this.turns.tryGetPendingHandoff(input);
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
    return new LangyConversationService(
      repository,
      commands,
      messages,
      events,
      finalParts,
      runtime,
      turnOrder,
    );
  }
}
