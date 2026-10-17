/**
 * The setup and teardown hooks around a scenario run's turns, as the child calls them (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { AgentHooks } from "@langwatch/agent-contract";
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  type ScenarioHookResult,
  type ScenarioHookStatus,
  type ScenarioRunHooks,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { isSpanContextValid, SpanStatusCode, trace } from "@opentelemetry/api";

type HookKind = "setup" | "teardown";
type RunState = Record<string, unknown>;

/** The agent the hooks are called on: the connected agent's channel, which holds the state. */
export interface ScenarioHookCaller {
  readonly runState: RunState | null;
  callHook(input: { kind: HookKind; timeoutMs: number }): Promise<{ state?: RunState }>;
}

/** Setup did not answer with a state, so the run plays no turn. */
export class ScenarioSetupFailedError extends Error {
  constructor(result: ScenarioHookResult) {
    super(
      result.status === "timed_out"
        ? `Scenario setup timed out: ${result.error ?? "no answer"}`
        : `Scenario setup failed: ${result.error ?? "no state"}`,
    );
    this.name = "ScenarioSetupFailedError";
  }
}

/** A run that failed after its hooks ran; carries what they did to the child's result line. */
export class ScenarioRunHooksError extends Error {
  readonly hooks: ScenarioRunHooks;
  readonly reason: unknown;

  constructor({ reason, hooks }: { reason: unknown; hooks: ScenarioRunHooks }) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = "ScenarioRunHooksError";
    this.reason = reason;
    this.hooks = hooks;
  }
}

const tracer = trace.getTracer("langwatch-scenario-child");

function statusOf(error: unknown): ScenarioHookStatus {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (code === "agent_call_timeout") return "timed_out";
  // No instance took the call, so the hook never ran.
  if (code === "agent_offline") return "not_run";
  return "failed";
}

/** Setup's answer is the run's state; teardown's is its returned object, beside the given state. */
function answeredResult({
  kind,
  base,
  answer,
}: {
  kind: HookKind;
  base: ScenarioHookResult;
  answer: { state?: RunState };
}): ScenarioHookResult {
  if (!answer.state) return base;
  return kind === "setup" ? { ...base, state: answer.state } : { ...base, returned: answer.state };
}

/** Calls a run's setup before its turns and its teardown after them, recording each (ADR-180). */
export class ScenarioRunHooksService {
  static create(options: {
    caller: ScenarioHookCaller;
    declared: AgentHooks;
    /** Skip teardown so the run's test data stays. */
    keepData?: boolean;
    timeoutMs?: number;
  }): ScenarioRunHooksService {
    return new ScenarioRunHooksService(options);
  }

  private constructor(
    private readonly options: {
      caller: ScenarioHookCaller;
      declared: AgentHooks;
      keepData?: boolean;
      timeoutMs?: number;
    },
  ) {}

  /**
   * Setup, then the turns, then teardown. Teardown runs in a `finally`: after a pass, a failure,
   * and a setup that failed or timed out. @throws ScenarioRunHooksError when setup or the turns
   * failed, carrying the hook results.
   */
  async around<T>(turns: () => Promise<T>): Promise<{ value: T; hooks: ScenarioRunHooks }> {
    const { declared } = this.options;
    // One record, filled by the finally after the return value or the error already holds it.
    const hooks: ScenarioRunHooks = {};
    try {
      if (declared.setup) {
        hooks.setup = await this.call("setup");
        if (hooks.setup.status !== "ok") throw new ScenarioSetupFailedError(hooks.setup);
      }
      return { value: await turns(), hooks };
    } catch (error) {
      throw new ScenarioRunHooksError({ reason: error, hooks });
    } finally {
      if (declared.teardown) hooks.teardown = await this.teardown();
    }
  }

  private teardown(): Promise<ScenarioHookResult> {
    if (!this.options.keepData) return this.call("teardown");
    const state = this.options.caller.runState;
    return Promise.resolve({ status: "skipped", durationMs: 0, ...(state ? { state } : {}) });
  }

  /** Calls one hook inside its own span; never throws, the outcome is the result. */
  private call(kind: HookKind): Promise<ScenarioHookResult> {
    const { caller, timeoutMs = DEFAULT_HOOK_TIMEOUT_MS } = this.options;
    const given = kind === "teardown" ? caller.runState : null;
    const startedAt = nowInstant().epochMilliseconds;
    return tracer.startActiveSpan(`scenario.${kind}`, async (span) => {
      const spanContext = span.spanContext();
      const base = (status: ScenarioHookStatus): ScenarioHookResult => ({
        status,
        durationMs: nowInstant().epochMilliseconds - startedAt,
        ...(isSpanContextValid(spanContext) ? { traceId: spanContext.traceId } : {}),
        ...(given ? { state: given } : {}),
      });
      try {
        const answer = await caller.callHook({ kind, timeoutMs });
        return answeredResult({ kind, base: base("ok"), answer });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        return { ...base(statusOf(error)), error: message };
      } finally {
        span.end();
      }
    });
  }
}
