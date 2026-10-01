/**
 * Runs the guardrails a virtual key references and aggregates them into the single verdict the Go
 * data plane consumes. A gateway guardrail binds an evaluator, eligible only with an enabled
 * as-guardrail monitor in the same project, and that monitor carries the check run here too.
 */

import type { EvaluationApi, GuardrailCheckOutcome } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type {
  GatewayGuardrailDirection,
  GuardrailWireDirection,
} from "@langwatch/gateway-contract";
import type { EnabledGuardrailMonitor, MonitorApi } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { GatewayGuardrailRepository } from "../repositories/gateway-guardrail.repository.ts";

const logger = createLogger("langwatch:gateway:guardrail-evaluation");

export type GuardrailDecision = "allow" | "block" | "modify";

export type GuardrailCheckContent = {
  messages?: unknown;
  output?: unknown;
  chunk?: unknown;
  tools?: unknown;
  mcps?: unknown;
};

export type GuardrailCheckVerdict = {
  decision: GuardrailDecision;
  reason: string | null;
  modified_content: Record<string, unknown> | null;
  policies_triggered: string[];
};

const WIRE_DIRECTION_TO_STORED: Record<GuardrailWireDirection, GatewayGuardrailDirection> = {
  request: "PRE",
  response: "POST",
  stream_chunk: "STREAM_CHUNK",
};

/** The pre-dispatch budget, from specs/ai-gateway/guardrails.feature "latency budget". */
export const REQUEST_GUARDRAIL_DEADLINE_MS = 800;
const DEADLINE_PASSED = Symbol("guardrail deadline passed");
const SIBLING_BLOCKED = Symbol("a sibling guardrail blocked");

/** A fail-closed guardrail out of time has no verdict: the check answers a retryable 503. */
type GuardrailOutcome = GuardrailCheckVerdict | "deadline_exceeded";
export type GuardrailCheckAnswer =
  | Readonly<{ status: "evaluated"; verdict: GuardrailCheckVerdict }>
  | Readonly<{ status: "deadline_exceeded" }>;

const ALLOW: GuardrailCheckVerdict = {
  decision: "allow",
  reason: null,
  modified_content: null,
  policies_triggered: [],
};

export class GatewayGuardrailEvaluationService {
  private constructor(
    private readonly repository: GatewayGuardrailRepository,
    private readonly monitors: MonitorApi,
    /** Evaluation owns running a guardrail's evaluator, its deadline and its cost. */
    private readonly evaluations: Pick<EvaluationApi, "checkGuardrail">,
  ) {}

  static create(input: {
    repository: GatewayGuardrailRepository;
    monitors: MonitorApi;
    evaluations: Pick<EvaluationApi, "checkGuardrail">;
  }): GatewayGuardrailEvaluationService {
    return new GatewayGuardrailEvaluationService(
      input.repository,
      input.monitors,
      input.evaluations,
    );
  }

  storedDirectionFor(direction: GuardrailWireDirection): GatewayGuardrailDirection {
    return WIRE_DIRECTION_TO_STORED[direction];
  }

  /**
   * Turn the content the data plane sent into the input/output pair evaluators
   * expect. Request-direction content carries the prompt, response and
   * stream_chunk carry generated text.
   */
  evaluationDataFor({
    direction,
    content,
  }: {
    direction: GuardrailWireDirection;
    content: GuardrailCheckContent | undefined;
  }): { input: string; output: string } {
    const asText = (value: unknown): string => {
      if (value === undefined || value === null) {
        return "";
      }

      if (typeof value === "string") {
        return value;
      }

      return JSON.stringify(value);
    };

    if (direction === "request") {
      // tools and mcps are part of what a request-direction guardrail is meant
      // to inspect. Scoring only the messages would let a policy that exists to
      // catch a dangerous tool call pass on an empty string.
      const parts = [content?.messages, content?.tools, content?.mcps]
        .filter((part) => part !== undefined && part !== null)
        .map(asText)
        .filter((part) => part !== "");

      return { input: parts.join("\n"), output: "" };
    }

    if (direction === "response") {
      return { input: "", output: asText(content?.output) };
    }

    return { input: "", output: asText(content?.chunk) };
  }

  /**
   * One deadline and one cancellation cover every guardrail, lookups included: the first block,
   * the request deadline or the caller's own abort stops the evaluators still running.
   */
  async check({
    projectId,
    guardrailIds,
    direction,
    content,
    signal,
  }: {
    projectId: string;
    guardrailIds: string[];
    direction: GuardrailWireDirection;
    content?: GuardrailCheckContent;
    signal?: AbortSignal | undefined;
  }): Promise<GuardrailCheckAnswer> {
    if (guardrailIds.length === 0) {
      return { status: "evaluated", verdict: ALLOW };
    }

    const settled = new AbortController();
    const deadlineAt =
      direction === "request"
        ? nowInstant().epochMilliseconds + REQUEST_GUARDRAIL_DEADLINE_MS
        : undefined;
    const deadline =
      deadlineAt === undefined
        ? undefined
        : setTimeout(() => settled.abort(DEADLINE_PASSED), REQUEST_GUARDRAIL_DEADLINE_MS);
    const run = signal ? AbortSignal.any([settled.signal, signal]) : settled.signal;

    try {
      const outcomes = await this.runAll({
        projectId,
        guardrailIds,
        direction,
        content,
        run,
        settled,
        deadlineAt,
      });

      return this.aggregate(outcomes);
    } catch (error) {
      // Stopped before any failure mode was known: never an allow, so a retryable 503.
      if (run.aborted) return { status: "deadline_exceeded" };
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }

  private async runAll({
    projectId,
    guardrailIds,
    direction,
    content,
    run,
    settled,
    deadlineAt,
  }: {
    projectId: string;
    guardrailIds: string[];
    direction: GuardrailWireDirection;
    content: GuardrailCheckContent | undefined;
    run: AbortSignal;
    settled: AbortController;
    deadlineAt: number | undefined;
  }): Promise<GuardrailOutcome[]> {
    const guardrails = await untilAborted({
      signal: run,
      work: this.repository.findRunnableForCheck({
        projectId,
        ids: guardrailIds,
        direction: this.storedDirectionFor(direction),
      }),
    });
    if (guardrails.length === 0) {
      return [];
    }

    const monitorsByEvaluator = await untilAborted({
      signal: run,
      work: this.guardrailMonitors({
        projectId,
        evaluatorIds: guardrails.map((guardrail) => guardrail.evaluatorId),
      }),
    });

    const data = this.evaluationDataFor({ direction, content });

    return Promise.all(
      guardrails.map(async (guardrail): Promise<GuardrailOutcome> => {
        const monitor = monitorsByEvaluator.get(guardrail.evaluatorId);
        // A guardrail whose evaluator lost its AS_GUARDRAIL monitor fails by its failure mode.
        const outcome = monitor
          ? await this.runOne({ guardrail, monitor, data, projectId, signal: run, deadlineAt })
          : this.onFailure({
              guardrail,
              reason: "guardrail evaluator is not enabled for guardrail execution",
            });
        if (outcome !== "deadline_exceeded" && outcome.decision === "block") {
          settled.abort(SIBLING_BLOCKED);
        }

        return outcome;
      }),
    );
  }

  private aggregate(outcomes: GuardrailOutcome[]): GuardrailCheckAnswer {
    const verdicts = outcomes.filter((outcome) => outcome !== "deadline_exceeded");
    const blocked = verdicts.filter((verdict) => verdict.decision === "block");
    if (blocked.length === 0) {
      return verdicts.length < outcomes.length
        ? { status: "deadline_exceeded" }
        : { status: "evaluated", verdict: ALLOW };
    }

    return {
      status: "evaluated",
      verdict: {
        decision: "block",
        reason:
          blocked
            .map((verdict) => verdict.reason)
            .filter(Boolean)
            .join("; ") || null,
        modified_content: null,
        policies_triggered: blocked.flatMap((verdict) => verdict.policies_triggered),
      },
    };
  }

  private async guardrailMonitors({
    projectId,
    evaluatorIds,
  }: {
    projectId: string;
    evaluatorIds: string[];
  }): Promise<Map<string, EnabledGuardrailMonitor>> {
    const monitors = await this.monitors.listEnabledGuardrailMonitors({
      projectId,
      evaluatorIds,
    });
    const byEvaluator = new Map<string, EnabledGuardrailMonitor>();
    for (const monitor of monitors) {
      if (!byEvaluator.has(monitor.evaluatorId)) {
        byEvaluator.set(monitor.evaluatorId, monitor);
      }
    }

    return byEvaluator;
  }

  private async runOne({
    guardrail,
    monitor,
    data,
    projectId,
    signal,
    deadlineAt,
  }: {
    guardrail: { id: string; name: string; failureMode: string };
    monitor: EnabledGuardrailMonitor;
    data: { input: string; output: string };
    projectId: string;
    signal: AbortSignal;
    deadlineAt: number | undefined;
  }): Promise<GuardrailOutcome> {
    if (signal.aborted) return this.onStopped({ guardrail, signal, by: "cancelled" });

    let outcome: GuardrailCheckOutcome;
    try {
      outcome = await this.evaluations.checkGuardrail({
        projectId,
        evaluatorType: monitor.checkType,
        settings: (monitor.parameters ?? {}) as Record<string, unknown>,
        data,
        guardrail: { id: guardrail.id, name: guardrail.name, monitorId: monitor.id },
        signal,
        deadlineMs:
          deadlineAt === undefined
            ? undefined
            : Math.max(0, deadlineAt - nowInstant().epochMilliseconds),
      });
    } catch (error) {
      logger.warn({ guardrailId: guardrail.id, projectId, error }, "guardrail evaluator threw");

      return this.onFailure({ guardrail, reason: "guardrail evaluator failed to run" });
    }

    if (outcome.status === "stopped") {
      logger.warn({ guardrailId: guardrail.id, projectId }, "guardrail stopped before a verdict");

      return this.onStopped({ guardrail, signal, by: outcome.by });
    }

    return this.verdictFor({ guardrail, result: outcome.result });
  }

  /** A sibling's block decided it; a deadline is no verdict; a cancel fails by mode. */
  private onStopped({
    guardrail,
    signal,
    by,
  }: {
    guardrail: { id: string; failureMode: string };
    signal: AbortSignal;
    by: "deadline" | "cancelled";
  }): GuardrailOutcome {
    if (signal.reason === SIBLING_BLOCKED) return ALLOW;
    if (by === "deadline" || signal.reason === DEADLINE_PASSED) {
      return guardrail.failureMode === "FAIL_OPEN" ? ALLOW : "deadline_exceeded";
    }

    return this.onFailure({ guardrail, reason: "guardrail check was cancelled" });
  }

  private verdictFor({
    guardrail,
    result,
  }: {
    guardrail: { id: string; name: string; failureMode: string };
    result: SingleEvaluationResult;
  }): GuardrailCheckVerdict {
    if (result.status === "error") {
      return this.onFailure({
        guardrail,
        reason: result.details || "guardrail evaluator returned an error",
      });
    }

    if (result.status === "skipped") {
      return ALLOW;
    }

    if (result.passed === false) {
      return {
        decision: "block",
        reason: result.details ?? `${guardrail.name} did not pass`,
        modified_content: null,
        policies_triggered: [guardrail.id],
      };
    }

    return ALLOW;
  }

  /**
   * An evaluator that cannot produce a verdict is not the same as one that
   * passed. FAIL_CLOSED is the default precisely so that a broken evaluator
   * cannot quietly disable the protection an operator switched on.
   */
  private onFailure({
    guardrail,
    reason,
  }: {
    guardrail: { id: string; failureMode: string };
    reason: string;
  }): GuardrailCheckVerdict {
    if (guardrail.failureMode === "FAIL_OPEN") {
      return ALLOW;
    }

    return {
      decision: "block",
      reason,
      modified_content: null,
      // The id, not the name: names are user-editable and not unique, while
      // the data plane and the audit trail treat the id as the policy handle.
      policies_triggered: [guardrail.id],
    };
  }
}

/** Settles with the work, or rejects as soon as the signal aborts even if the work ignores it. */
function untilAborted<T>({ work, signal }: { work: Promise<T>; signal: AbortSignal }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .finally(() => signal.removeEventListener("abort", onAbort))
      .then(resolve)
      .catch(reject);
  });
}
