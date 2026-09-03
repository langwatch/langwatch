/**
 * Per-turn orchestration over one pi AgentSession: system-prompt
 * recomposition, event fan-out, abort, preemption, and the terminal-last
 * invariant.
 *
 * Prior-art notes (agentic-pi, @ai-sdk/harness-pi):
 * - session event listeners run synchronously inside `session.prompt()`; a
 *   throw there would reject the prompt, so every listener body is contained.
 * - `session.abort()` from inside a listener or a command handler is
 *   fire-and-forget (`void ... .catch()`): awaiting its `waitForIdle` from a
 *   listener deadlocks.
 * - `prompt()` resolving is decoupled from a clean finish: the terminal
 *   outcome is derived from OUR abort/shutdown flags first, then the last
 *   assistant message's `stopReason`/`errorMessage` (the harness-pi rule:
 *   `stopReason === "error" | "aborted"` is terminal), so a provider error is
 *   never reported as ok.
 */

import { buildHandoffDigest } from "./digest.js";
import { TurnEventMapper, type SessionEventLike } from "./events.js";
import { boundText, type TerminalEvent, type TurnCommand } from "./protocol.js";
import { prependResumeSeed } from "./system-prompt.js";
import type { ProtocolWriter } from "./writer.js";

/** The slice of pi's AgentSession the runner drives (injectable for tests). */
export type SessionLike = {
  prompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  agent: {
    state: {
      messages: unknown[];
      errorMessage?: string;
    };
  };
};

type TurnState = {
  turnId: string;
  abortRequested: boolean;
  shutdownRequested: boolean;
  terminalEmitted: boolean;
  mapper: TurnEventMapper;
};

export type TurnRunnerOptions = {
  session: SessionLike;
  writer: ProtocolWriter;
  composeSystem: (turnSystem?: string) => string;
  /**
   * Hands the composed prompt to the session's system-prompt holder; the
   * `before_agent_start` extension serves it on the next prompt (direct
   * `agent.state.systemPrompt` assignment does not survive `prompt()`).
   */
  applySystemPrompt: (systemPrompt: string) => void;
  warn?: (message: string) => void;
  /**
   * True when the session continued a persisted transcript at boot. A turn's
   * `resumeToken` (the shutdown-handoff digest) is then skipped: the session's
   * own history is the single copy of the conversation, and prepending a
   * digest of it would re-tell the story and break the byte-stable prefix.
   */
  sessionResumed?: boolean;
};

export class TurnRunner {
  private current: TurnState | null = null;
  private running: Promise<void> = Promise.resolve();
  private submitSeq = 0;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: TurnRunnerOptions) {
    this.warn = options.warn ?? ((message) => process.stderr.write(`langy-worker: ${message}\n`));
  }

  /** Wire this to `session.subscribe`. Contained: never throws. */
  onSessionEvent = (event: SessionEventLike): void => {
    const state = this.current;
    if (!state || state.terminalEmitted) return;
    try {
      for (const mapped of state.mapper.map(event)) {
        void this.options.writer.emit(mapped);
      }
    } catch (error) {
      this.warn(
        `event mapping failed (${event.type}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  /**
   * Run a turn. A turn submitted while another runs aborts the running one
   * first; the old turn reaches its aborted terminal before the new one's
   * turn_started (turns are chained, never interleaved).
   */
  submitTurn(command: TurnCommand): Promise<void> {
    const seq = ++this.submitSeq;
    const state = this.current;
    if (state && !state.terminalEmitted) {
      state.abortRequested = true;
      void this.options.session.abort().catch(() => undefined);
    }
    const previous = this.running;
    this.running = (async () => {
      await previous.catch(() => undefined);
      if (seq !== this.submitSeq) {
        // A newer turn arrived while this one was still queued: it is
        // preempted before ever prompting, but still gets its full
        // turn_started + aborted terminal pair.
        await this.options.writer.emit({ type: "turn_started", turnId: command.turnId });
        await this.options.writer.emit({
          type: "turn_done",
          turnId: command.turnId,
          outcome: "aborted",
        });
        return;
      }
      await this.runTurn(command);
    })();
    return this.running;
  }

  /** `abort` command: turnId-guarded; a stale abort is ignored. */
  abortTurn(turnId: string): void {
    const state = this.current;
    if (!state || state.terminalEmitted || state.turnId !== turnId) return;
    state.abortRequested = true;
    void this.options.session.abort().catch(() => undefined);
  }

  /**
   * `shutdown_imminent`: abort the in-flight LLM call and let the turn
   * terminate with a `handoff` digest. Idle is a no-op: the previous turn
   * already reached its terminal and the session file holds the history.
   */
  shutdownImminent(): void {
    const state = this.current;
    if (!state || state.terminalEmitted) {
      this.warn("shutdown_imminent with no turn in flight; nothing to hand off");
      return;
    }
    state.shutdownRequested = true;
    void this.options.session.abort().catch(() => undefined);
  }

  /** stdin EOF: abort in-flight work so its aborted terminal still lands. */
  async abortForExit(): Promise<void> {
    const state = this.current;
    if (state && !state.terminalEmitted) {
      state.abortRequested = true;
      void this.options.session.abort().catch(() => undefined);
    }
    await this.running.catch(() => undefined);
  }

  /** Resolves when the current chain of turns has fully settled. */
  settled(): Promise<void> {
    return this.running.catch(() => undefined);
  }

  private async runTurn(command: TurnCommand): Promise<void> {
    const { session, writer, composeSystem } = this.options;
    const state: TurnState = {
      turnId: command.turnId,
      abortRequested: false,
      shutdownRequested: false,
      terminalEmitted: false,
      mapper: new TurnEventMapper(command.turnId),
    };
    this.current = state;

    let terminal: TerminalEvent;
    try {
      // Recomposed every turn: persona + AGENTS.md + this turn's system block,
      // served through the before_agent_start extension on the next prompt
      // (see system-prompt.ts for why this is the mechanism).
      this.options.applySystemPrompt(composeSystem(command.system));

      await writer.emit({ type: "turn_started", turnId: command.turnId });

      const prompt =
        command.resumeToken && !this.options.sessionResumed
          ? prependResumeSeed({ prompt: command.prompt, seed: command.resumeToken })
          : command.prompt;

      let thrown: unknown;
      try {
        await session.prompt(prompt);
      } catch (error) {
        thrown = error;
      }

      terminal = this.deriveTerminal(state, thrown);
    } catch (error) {
      // A failure in our own orchestration still terminates the turn.
      terminal = {
        type: "turn_done",
        turnId: command.turnId,
        outcome: "error",
        errorMessage: boundText({
          text: error instanceof Error ? error.message : String(error),
        }),
      };
    }

    state.terminalEmitted = true;
    this.current = null;
    // The terminal is flushed to the pipe before anything else can run.
    await writer.emit(terminal);
  }

  private deriveTerminal(state: TurnState, thrown: unknown): TerminalEvent {
    const { session } = this.options;
    if (state.shutdownRequested) {
      let seed = "";
      try {
        seed = buildHandoffDigest({ messages: session.agent.state.messages });
      } catch (error) {
        this.warn(
          `handoff digest failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { type: "handoff", turnId: state.turnId, seed };
    }
    if (state.abortRequested) {
      return { type: "turn_done", turnId: state.turnId, outcome: "aborted" };
    }
    if (thrown !== undefined) {
      return {
        type: "turn_done",
        turnId: state.turnId,
        outcome: "error",
        errorMessage: boundText({
          text: thrown instanceof Error ? thrown.message : String(thrown),
        }),
      };
    }
    const assistantError = lastAssistantError(session.agent.state.messages);
    if (assistantError) {
      if (assistantError.kind === "aborted") {
        return { type: "turn_done", turnId: state.turnId, outcome: "aborted" };
      }
      return {
        type: "turn_done",
        turnId: state.turnId,
        outcome: "error",
        errorMessage: boundText({ text: assistantError.message }),
      };
    }
    return { type: "turn_done", turnId: state.turnId, outcome: "ok" };
  }
}

type AssistantError = { kind: "error" | "aborted"; message: string };

/**
 * The harness-pi rule: the last assistant message's `stopReason` of "error" or
 * "aborted" is terminal; `errorMessage` carries the cause when present.
 */
export function lastAssistantError(messages: unknown[]): AssistantError | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as
      | { role?: string; stopReason?: string; errorMessage?: string }
      | undefined;
    if (message?.role !== "assistant") continue;
    if (message.stopReason === "error") {
      return { kind: "error", message: message.errorMessage?.trim() || "agent error" };
    }
    if (message.stopReason === "aborted") {
      return { kind: "aborted", message: message.errorMessage?.trim() || "aborted" };
    }
    return undefined;
  }
  return undefined;
}
