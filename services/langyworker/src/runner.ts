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
import {
  boundText,
  type GuidedTurnEvent,
  type TerminalEvent,
  type TurnCommand,
} from "./protocol.js";
import {
  GUIDED_ONBOARDING_SKILL_NAME,
  isGuidedKickoffPrompt,
  isGuidedTurn,
  prependSkillBody,
} from "./guided-kickoff.js";
import {
  GUIDED_TURN_BARE_END_LOG,
  GUIDED_TURN_CONTINUED_LOG,
  TurnCallLog,
  decideGuidedContinuation,
  guidedSegment,
} from "./guided-turn-end.js";
import { prependResumeSeed } from "./system-prompt.js";
import type { TurnContext } from "./tools/turn-context.js";
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
  /** The turn's settled calls, read by the guided turn end guard. */
  calls: TurnCallLog;
  /**
   * The turn is on the guided path, read once from the composed prompt and
   * the history before the prompt goes out; the skill tool and the guard
   * read this one value.
   */
  guided: boolean;
  /** The segment of the turn the guard last read: 1, plus one per card answered inside the turn. */
  segment: number;
  /** Continuation messages appended to that segment so far; one is the limit. */
  continuations: number;
  /** Continuation messages appended to the turn over all its segments; MAX_TURN_CONTINUATIONS is the cap. */
  turnContinuations: number;
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
   * The holder the local tools read to name the turn they belong to. It carries
   * the turn in flight and goes back to null at the terminal, so a tool that
   * somehow runs between turns names no turn instead of a stale one.
   */
  turnContext?: TurnContext;
  /**
   * True when the session continued a persisted transcript at boot. A turn's
   * `resumeToken` (the shutdown-handoff digest) is then skipped: the session's
   * own history is the single copy of the conversation, and prepending a
   * digest of it would re-tell the story and break the byte-stable prefix.
   */
  sessionResumed?: boolean;
  /**
   * Reads an installed skill's SKILL.md by name. A guided onboarding kickoff
   * turn gets the guided-onboarding skill placed ahead of its message, so the
   * script is in context before the model chooses anything.
   */
  loadSkill?: (name: string) => string | undefined;
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
      state.calls.record(event);
      for (const mapped of state.mapper.map(event)) {
        void this.options.writer.emit(mapped);
      }
    } catch (error) {
      this.warn(`event mapping failed (${event.type}): ${error instanceof Error ? error.message : String(error)}`);
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
      await this.runTurn(command, seq);
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

  private async runTurn(command: TurnCommand, seq: number): Promise<void> {
    const { session, writer, composeSystem } = this.options;
    const state: TurnState = {
      turnId: command.turnId,
      abortRequested: false,
      shutdownRequested: false,
      terminalEmitted: false,
      mapper: new TurnEventMapper(command.turnId),
      calls: new TurnCallLog(),
      guided: false,
      segment: 1,
      continuations: 0,
      turnContinuations: 0,
    };
    this.current = state;
    if (this.options.turnContext) {
      this.options.turnContext.turnId = command.turnId;
      this.options.turnContext.calls = state.calls.calls;
    }

    let terminal: TerminalEvent;
    try {
      // Recomposed every turn: persona + AGENTS.md + this turn's system block,
      // served through the before_agent_start extension on the next prompt
      // (see system-prompt.ts for why this is the mechanism).
      this.options.applySystemPrompt(composeSystem(command.system));

      await writer.emit({ type: "turn_started", turnId: command.turnId });

      const prompt = this.composePrompt(command);
      state.guided = isGuidedTurn({ prompt, history: session.agent.state.messages });
      if (this.options.turnContext) this.options.turnContext.guided = state.guided;

      let thrown: unknown;
      try {
        await session.prompt(prompt);
      } catch (error) {
        thrown = error;
      }

      terminal = await this.continueGuidedTurn({
        command,
        state,
        seq,
        terminal: this.deriveTerminal(state, thrown),
      });
    } catch (error) {
      // A failure in our own orchestration still terminates the turn.
      terminal = {
        type: "turn_done",
        turnId: command.turnId,
        outcome: "error",
        errorMessage: boundText({ text: error instanceof Error ? error.message : String(error) }),
      };
    }

    state.terminalEmitted = true;
    this.current = null;
    if (this.options.turnContext) {
      this.options.turnContext.turnId = null;
      this.options.turnContext.calls = [];
      this.options.turnContext.guided = false;
    }
    // The terminal is flushed to the pipe before anything else can run.
    await writer.emit(terminal);
  }

  /**
   * The message as the model reads it: a kickoff brief behind its skill, and
   * a handoff digest ahead of everything when the turn resumes one.
   */
  private composePrompt(command: TurnCommand): string {
    let prompt = command.prompt;
    if (this.options.loadSkill && isGuidedKickoffPrompt(prompt)) {
      const body = this.options.loadSkill(GUIDED_ONBOARDING_SKILL_NAME);
      if (body) {
        prompt = prependSkillBody({ prompt, name: GUIDED_ONBOARDING_SKILL_NAME, body });
      } else {
        this.warn(
          `skill "${GUIDED_ONBOARDING_SKILL_NAME}" is not installed; the kickoff runs on the routing row alone`,
        );
      }
    }
    if (command.resumeToken && !this.options.sessionResumed) {
      prompt = prependResumeSeed({ prompt, seed: command.resumeToken });
    }
    return prompt;
  }

  /**
   * The guided turn end guard. A turn on the guided path that ended clean but
   * on none of the calls the skill allows (a card still waiting, the closing
   * line, the one line of a failed step) gets one continuation message,
   * appended to the same turn, naming what it still owes; the model goes on
   * and the terminal is derived again. A second bare end is reported and
   * left. A card answered inside the turn starts a new segment with a
   * continuation of its own, capped over the turn. A newer turn from the
   * user, submitted meanwhile, takes precedence: the turn is theirs to
   * continue then, not the guard's.
   */
  private async continueGuidedTurn({
    command,
    state,
    seq,
    terminal,
  }: {
    command: TurnCommand;
    state: TurnState;
    seq: number;
    terminal: TerminalEvent;
  }): Promise<TerminalEvent> {
    if (terminal.type !== "turn_done" || terminal.outcome !== "ok") return terminal;
    const segment = guidedSegment(state.calls.calls).index;
    if (segment !== state.segment) {
      state.segment = segment;
      state.continuations = 0;
    }
    const decision = decideGuidedContinuation({
      calls: state.calls.calls,
      guided: state.guided,
      continuations: state.continuations,
      turnContinuations: state.turnContinuations,
      history: this.options.session.agent.state.messages,
    });
    if (decision.kind === "leave") return terminal;
    if (decision.kind === "give_up") {
      await this.reportGuidedTurn({ state, event: GUIDED_TURN_BARE_END_LOG, decision });
      return terminal;
    }
    if (state.abortRequested || seq !== this.submitSeq) return terminal;
    state.continuations += 1;
    state.turnContinuations += 1;
    await this.reportGuidedTurn({ state, event: GUIDED_TURN_CONTINUED_LOG, decision });
    let thrown: unknown;
    try {
      await this.options.session.prompt(decision.message);
    } catch (error) {
      thrown = error;
    }
    return this.continueGuidedTurn({
      command,
      state,
      seq,
      terminal: this.deriveTerminal(state, thrown),
    });
  }

  /**
   * The guard's report goes to the manager as a protocol event, ahead of the
   * turn's terminal. The manager does not read worker stderr, so a log line
   * written here would be lost; it logs the event under its name, with the
   * turn id, the segment and what the turn owed.
   */
  private async reportGuidedTurn({
    state,
    event,
    decision,
  }: {
    state: TurnState;
    event: GuidedTurnEvent["event"];
    decision: { segment: number; missing: string[] };
  }): Promise<void> {
    const report: GuidedTurnEvent = {
      type: "guided_turn",
      turnId: state.turnId,
      event,
      segment: decision.segment,
      missing: decision.missing,
    };
    await this.options.writer.emit(report);
  }

  private deriveTerminal(state: TurnState, thrown: unknown): TerminalEvent {
    const { session } = this.options;
    if (state.shutdownRequested) {
      let seed = "";
      try {
        seed = buildHandoffDigest({ messages: session.agent.state.messages });
      } catch (error) {
        this.warn(`handoff digest failed: ${error instanceof Error ? error.message : String(error)}`);
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
        errorMessage: boundText({ text: thrown instanceof Error ? thrown.message : String(thrown) }),
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
