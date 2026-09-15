// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Activities folded into what a person would recognise: turns of one user message and the agent's
 * reply, and the tool calls an agent made along the way. A call is identified by its own id, so a
 * repeated pull folds onto the same call rather than inventing a second one.
 */

import {
  GUID,
  ROLE_AGENT,
  ROLE_USER,
  type Activity,
  type ReadableMessage,
  type ToolCall,
  type ToolCallTrace,
  type ToolCallValue,
  type Turn,
  type TurnAccumulator,
} from "../rules/copilot-transcript.rules.ts";
import { CopilotTranscriptGroupingService } from "./copilot-transcript-grouping.service.ts";

export class CopilotTurnAssemblyService {
  private constructor() {}

  static create(): CopilotTurnAssemblyService {
    return new CopilotTurnAssemblyService();
  }

  static textOf(activity: Activity): string {
    return typeof activity.text === "string" ? activity.text.trim() : "";
  }

  /**
   * A message a turn can be built from, or null.
   *
   * Never invented: a message with no GUID and a message that cannot be dated
   * are both rejected here rather than given a made-up identity or the clock.
   */
  static tryReadableMessage(activity: Activity): ReadableMessage | null {
    const id = typeof activity.id === "string" ? activity.id : "";
    const ms = CopilotTranscriptGroupingService.tryActivityMs(activity);
    const text = CopilotTurnAssemblyService.textOf(activity);
    if (!GUID.test(id) || ms === null || !text) {
      return null;
    }

    const aad = activity.from?.aadObjectId;

    return {
      id,
      ms,
      text,
      role: CopilotTranscriptGroupingService.tryRoleOf(activity.from?.role),
      // `from.id` is deliberately not consulted. It is GUID-shaped and looks
      // like an account, but it is per-conversation and naming a person by it
      // would invent one person per conversation.
      aadObjectId: typeof aad === "string" && aad ? aad : null,
    };
  }

  static closeTurn(state: TurnAccumulator): void {
    if (state.open) {
      state.turns.push(state.open);
    }

    state.open = null;
  }

  /**
   * Fold one message into the turns built so far.
   *
   * A user message opens a turn and the agent messages that follow close it.
   * An agent message with no user message before it is its own turn — the agent
   * greets first, and dropping that would lose the opening line of most
   * conversations.
   */
  static applyMessage(params: { state: TurnAccumulator; message: ReadableMessage }): void {
    const { state, message } = params;

    if (message.role === ROLE_USER) {
      CopilotTurnAssemblyService.closeTurn(state);
      state.open = {
        seedActivityId: message.id,
        question: message.text,
        answer: null,
        authorAadObjectId: message.aadObjectId,
        startMs: message.ms,
        endMs: message.ms,
      };

      return;
    }

    if (message.role === ROLE_AGENT) {
      const open = state.open;
      if (open) {
        open.answer = open.answer ? `${open.answer}\n\n${message.text}` : message.text;
        open.endMs = Math.max(open.endMs, message.ms);

        return;
      }

      state.turns.push({
        seedActivityId: message.id,
        question: null,
        answer: message.text,
        authorAadObjectId: null,
        startMs: message.ms,
        endMs: message.ms,
      });

      return;
    }

    // Said something, cannot be attributed to either side. Counting it is the
    // whole point: the alternative is a conversation whose every message has
    // an unreadable role producing no turns at all, which reaches
    // `tryAssembleTraceRequest` as an empty span list and disappears with no
    // log, no attribute and no error — indistinguishable from a pull that
    // found nothing.
    state.skipped += 1;
  }

  /**
   * Pair message activities into turns.
   *
   * Skipped and counted, never invented: a message with no GUID, and a message
   * that cannot be dated.
   */
  static turnsOf(activities: Activity[]): {
    turns: Turn[];
    skipped: number;
  } {
    const state: TurnAccumulator = { turns: [], open: null, skipped: 0 };

    for (const activity of activities) {
      if (activity.type !== "message") {
        continue;
      }

      const message = CopilotTurnAssemblyService.tryReadableMessage(activity);
      if (!message) {
        // A message with nothing said is not a skip worth counting — there is
        // no turn being lost. A message that said something but cannot be
        // identified or dated is.
        if (CopilotTurnAssemblyService.textOf(activity)) {
          state.skipped += 1;
        }

        continue;
      }

      CopilotTurnAssemblyService.applyMessage({ state, message });
    }

    CopilotTurnAssemblyService.closeTurn(state);

    return { turns: state.turns, skipped: state.skipped };
  }

  /** The most human of the names the trace carries. */
  static toolNameOf(value: ToolCallValue): string {
    return (
      (typeof value.toolDisplayName === "string" && value.toolDisplayName) ||
      (typeof value.toolName === "string" && value.toolName) ||
      "tool"
    );
  }

  /**
   * What pairs a start with its completion: the call id when the trace names
   * one, and otherwise the activity's own id, which pairs it with nothing and
   * so stands alone.
   */
  static callIdOf(params: { value: ToolCallValue; activityId: string }): string {
    const { value, activityId } = params;

    return typeof value.toolCallId === "string" && value.toolCallId ? value.toolCallId : activityId;
  }

  /**
   * One tool-call trace, or null when the activity is not one or cannot be
   * identified or dated.
   */
  static tryToolCallTraceOf(activity: Activity): ToolCallTrace | null {
    if (activity.type !== "event") {
      return null;
    }

    if (!(activity.name ?? "").startsWith("ToolCallTrace:")) {
      return null;
    }

    const id = typeof activity.id === "string" ? activity.id : "";
    const ms = CopilotTranscriptGroupingService.tryActivityMs(activity);
    if (!GUID.test(id) || ms === null) {
      return null;
    }

    const value = (CopilotTranscriptGroupingService.tryAsObject(activity.value) ??
      {}) as ToolCallValue;

    return {
      callId: CopilotTurnAssemblyService.callIdOf({ value, activityId: id }),
      seedActivityId: id,
      name: CopilotTurnAssemblyService.toolNameOf(value),
      arguments: value.filledParameters ? JSON.stringify(value.filledParameters) : null,
      ms,
      isCompleted: (value.toolCallStatus ?? "").toLowerCase() === "completed",
    };
  }

  static toolCallsOf(activities: Activity[]): ToolCall[] {
    const byCallId = new Map<string, ToolCall>();
    for (const activity of activities) {
      const trace = CopilotTurnAssemblyService.tryToolCallTraceOf(activity);
      if (!trace) {
        continue;
      }

      const existing = byCallId.get(trace.callId);
      if (existing) {
        // The first trace for a call seeds it, and that is safe here only
        // because of what runs before: this walks `group.activities`, which is
        // already time-ordered, and `toolCallTraceOf` refuses any trace it
        // cannot date. An undated trace therefore never reaches this map, and
        // among dated ones the earliest is always seen first — so the seed is
        // the start, never a completion that happened to be stored above it.
        existing.endMs = Math.max(existing.endMs, trace.ms);
        if (trace.isCompleted) {
          existing.isFinished = true;
        }

        continue;
      }

      byCallId.set(trace.callId, {
        seedActivityId: trace.seedActivityId,
        name: trace.name,
        arguments: trace.arguments,
        startMs: trace.ms,
        endMs: trace.ms,
        isFinished: trace.isCompleted,
      });
    }

    return [...byCallId.values()].sort((a, b) => a.startMs - b.startMs);
  }
}
