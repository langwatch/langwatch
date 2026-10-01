import { HandledError } from "@langwatch/handled-error";
import type {
  LangyConversationStartedEventData,
  LangyMessagePart,
  LangyMessageRecordedEventData,
  LangyMessageRole,
} from "@langwatch/langy-contract";
import { langyJsonValueSchema, LangyTurnErrors } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { LangyConversationCommands } from "../app/langy.members.ts";
import type { LangyConversationRepository } from "../repositories/langy-conversation-projection.repository.ts";
import { turnMessageId } from "../rules/langy-conversation-shape.rules.ts";
import type { LangyConversationRuntime } from "./langy-conversation.service.ts";
import {
  type LangyFinalPartsService,
  type LangyFinalToolCall,
} from "./langy-final-parts.service.ts";
import type { LangyTurnOrderReader, LangyTurnSegment } from "./langy-turn-order.service.ts";

/**
 * Everything one turn writes to the log: the user's message, the acceptance, each tool call,
 * the plan, the failure, the handoff to a worker and the final parts. The assistant message id
 * is derived from the turn id, so however many times finalize lands it dedups.
 */
const turnServiceLogger = createLogger("langwatch:langy:conversation-service");

type LangyConversationTurnOptions = {
  repository: LangyConversationRepository;
  commands: LangyConversationCommands;
  finalParts: LangyFinalPartsService;
  runtime: LangyConversationRuntime;
  turnOrder: LangyTurnOrderReader | null;
};

export class LangyConversationTurnService {
  static create(deps: LangyConversationTurnOptions): LangyConversationTurnService {
    return new LangyConversationTurnService(deps);
  }

  private constructor(private readonly deps: LangyConversationTurnOptions) {}

  /**
   * The turn's own account of what happened, folded off its live stream.
   * Read here since two paths finalize a turn (relay + agent HTTP post)
   * and whichever lands first wins. Best effort: a failed read still records what it can.
   */
  private async readTurnOrder(at: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnSegment[]> {
    if (!this.deps.turnOrder) {
      return [];
    }

    try {
      return await this.deps.turnOrder.readTurnOrder(at);
    } catch (error) {
      turnServiceLogger.warn(
        { ...at, error },
        "could not read a turn's order; recording its calls before its reply",
      );

      return [];
    }
  }

  /**
   * Records the user's message: one `message_recorded` event feeds both
   * conversation state (count/activity/owner/title) and the operational
   * message projection, replacing the old separate writes.
   */
  async recordUserMessage({
    projectId,
    conversationId,
    userId,
    parts,
    title,
    role = "user",
    messageId,
  }: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: LangyMessagePart[];
    title?: string | null;
    role?: LangyMessageRole;
    /** Stable logical-send identity supplied by the turn orchestrator. */
    messageId?: string;
  }): Promise<{ messageId: string }> {
    const resolvedMessageId = messageId ?? this.deps.runtime.generateId("message");
    await this.deps.commands.recordMessage({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      userId,
      messageId: resolvedMessageId,
      role,
      parts,
      title: title ?? null,
    });

    return { messageId: resolvedMessageId };
  }

  /**
   * Durably accepts an agent turn; returns the turnId to correlate finalize.
   * Accepts an optional turnId so a caller can stash the spawn handoff
   * (ADR-044) before `agent_turn_accepted` dispatches, closing an outbox race.
   */
  async acceptTurn({
    projectId,
    conversationId,
    turnId,
    questionParts,
    model,
    conversationStart,
    userMessage,
    consumeHandoffTurnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId?: string;
    /** The user's question that opened the turn — folded into the turn document. */
    questionParts?: LangyMessagePart[];
    /** The model this turn runs on — the fold keeps the latest as `LastModel`. */
    model?: string;
    /** Optional first-event marker, committed atomically before acceptance. */
    conversationStart?: Omit<LangyConversationStartedEventData, "conversationId">;
    /** Optional user message, committed atomically before acceptance. */
    userMessage?: Omit<LangyMessageRecordedEventData, "conversationId">;
    /** Prior checkpoint-producing turn consumed atomically with this start. */
    consumeHandoffTurnId?: string;
  }): Promise<{ turnId: string }> {
    const resolvedTurnId = turnId ?? this.deps.runtime.createTurnId();
    await this.deps.commands.acceptAgentTurn({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId: resolvedTurnId,
      ...(questionParts !== undefined ? { questionParts } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(conversationStart ? { conversationStart } : {}),
      ...(userMessage ? { userMessage } : {}),
      ...(consumeHandoffTurnId ? { consumeHandoffTurnId } : {}),
    });

    return { turnId: resolvedTurnId };
  }

  /**
   * Record a durable turn milestone: a tool the agent began running. Transient
   * progress ticks stay ephemeral (Redis); a tool call is a meaningful audit of
   * what the agent did, so it is a durable event (ADR-044).
   */
  async recordToolCallStarted({
    projectId,
    conversationId,
    turnId,
    toolCallId,
    toolName,
    command,
    input,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    command?: string;
    input?: unknown;
  }): Promise<void> {
    const jsonInput = input === undefined ? undefined : langyJsonValueSchema.parse(input);
    await this.deps.commands.initiateToolCall({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId,
      toolCallId,
      toolName,
      ...(command !== undefined ? { command } : {}),
      ...(jsonInput !== undefined ? { input: jsonInput } : {}),
    });
  }

  /**
   * Records a tool call's terminal: `isError` routes to `tool_call_failed`
   * (carrying `errorText`), otherwise `tool_call_succeeded`. Both share the
   * `tool-done:<toolCallId>` idempotency slot, so the first terminal wins.
   */
  async recordToolCallCompleted({
    projectId,
    conversationId,
    turnId,
    toolCallId,
    toolName,
    isError,
    command,
    input,
    durationMs,
    errorText,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    command?: string;
    input?: unknown;
    durationMs?: number;
    errorText?: string;
  }): Promise<void> {
    const jsonInput = input === undefined ? undefined : langyJsonValueSchema.parse(input);
    const shared = {
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId,
      toolCallId,
      toolName,
      ...(command !== undefined ? { command } : {}),
      ...(jsonInput !== undefined ? { input: jsonInput } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
    if (isError) {
      await this.deps.commands.failToolCall({
        ...shared,
        ...(errorText !== undefined ? { errorText } : {}),
      });
    } else {
      await this.deps.commands.succeedToolCall(shared);
    }
  }

  /**
   * Records a plan snapshot (a settled `todowrite`). Last-write-wins on the
   * turn fold, dispatched at-most-once per snapshot since the relay already
   * drops redelivered frames by nonce.
   */
  async recordPlanUpdated({
    projectId,
    conversationId,
    turnId,
    items,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    items: { content: string; status: string }[];
  }): Promise<void> {
    await this.deps.commands.updatePlan({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId,
      items,
    });
  }

  /**
   * Terminal failure for a response with nothing to carry (stalled/orphaned,
   * drained by the liveness sweep or on shutdown). Emits
   * `agent_response_failed`, clearing CurrentTurnId and surfacing the error.
   */
  async failTurn({
    projectId,
    conversationId,
    turnId,
    error,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    error: string;
  }): Promise<void> {
    await this.deps.commands.failAgentResponse({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId,
      error,
    });
  }

  /**
   * Ingest turn result via HTTP (independent, at-least-once path when relay's stream dropped).
   * Idempotent on turnId; verifies turn triple accepted (no HMAC, shared bearer only).
   */
  async turnExists({
    projectId,
    conversationId,
    turnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    return this.deps.repository.turnExists({ projectId, conversationId, turnId });
  }

  async ingestAgentTurnResult({
    projectId,
    conversationId,
    turnId,
    status,
    text,
    toolCalls,
    errorCode,
    errorCause,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    status: "completed" | "failed";
    text?: string;
    toolCalls?: LangyFinalToolCall[];
    errorCode?: string;
    /**
     * The failure's typed cause chain when known (deserialized at the
     * boundary) — classified here so `LastError` names the REAL failure (e.g.
     * gateway's no_provider_configured) with the chain as reasons.
     */
    errorCause?: HandledError;
  }): Promise<void> {
    if (status === "failed") {
      await this.failTurn({
        projectId,
        conversationId,
        turnId,
        error: LangyTurnErrors.serialize(
          LangyTurnErrors.fromErrorFrame({
            code: errorCode ?? "agent error",
            ...(errorCause !== undefined ? { cause: errorCause } : {}),
          }),
        ),
      });

      return;
    }

    const order = await this.readTurnOrder({ conversationId, turnId });
    await this.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: this.deps.finalParts.build({
        text: text ?? "",
        toolCalls,
        ...(order.length > 0 ? { order } : {}),
      }),
      outcome: "completed",
    });
  }

  /**
   * Turn's own account folded off live stream. Read here since both relay and HTTP post paths
   * finalize (first wins). Best effort: failed read still records what it can.
   */

  /**
   * The pending shutdown-handoff for a conversation, or null (ADR-048). Read
   * from the fold; the token is opaque to the control plane.
   */
  async findPendingHandoff({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<{ token: string; turnId: string } | null> {
    return this.deps.repository
      .getResumeState({ projectId, conversationId })
      .then((state) => state.pendingHandoff)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "langy_conversation_not_found") {
          return null;
        }
        throw error;
      });
  }

  /**
   * Persists an opaque worker-authored resume token left on pod termination
   * (ADR-048, `conversation_handoff_pending`). Clears CurrentTurnId and
   * stores the token for the next turn to resume from.
   */
  async recordTurnHandoff({
    projectId,
    conversationId,
    turnId,
    token,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    token: string;
  }): Promise<void> {
    await this.deps.commands.recordTurnHandoff({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId,
      token,
    });
  }

  /**
   * Clear a pending handoff once the next turn has threaded it to a fresh
   * worker (ADR-048): `conversation_handoff_consumed`. Idempotent on the turn,
   * so a double-consume collapses to one durable event.
   */
  async consumeHandoff({
    projectId,
    conversationId,
    turnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    await this.deps.commands.consumeTurnHandoff({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId,
    });
  }

  /**
   * Finalize agent response (agent_responded carries whole answer). messageId is DERIVED from
   * turnId, never fresh: finalize has two independent writers (relay + POST).
   */
  async finalizeTurn({
    projectId,
    conversationId,
    turnId,
    parts,
    outcome = "completed",
    error,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    parts: LangyMessagePart[];
    // `stopped` is a user-initiated stop carrying the partial answer (ADR-078);
    // it shares agent_responded's turn-terminal slot with completed/failed, so a
    // stop racing a natural finish collapses to exactly one terminal.
    outcome?: "completed" | "failed" | "stopped";
    error?: string | null;
  }): Promise<{ messageId: string }> {
    const messageId = turnMessageId(turnId);
    await this.deps.commands.recordAgentResponse({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId,
      turnId,
      messageId,
      role: "assistant",
      parts,
      outcome,
      error: error ?? null,
    });

    return { messageId };
  }
}
