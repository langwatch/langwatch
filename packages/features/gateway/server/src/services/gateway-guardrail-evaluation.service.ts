/**
 * Runs the guardrails a virtual key references and aggregates them into the
 * single verdict the Go data plane consumes.
 *
 * A GatewayGuardrail binds an Evaluator, which is only eligible once it has an
 * enabled Monitor with executionMode AS_GUARDRAIL in the same project. That
 * monitor carries the check type and parameters the evaluator runs with, so it
 * is the execution surface here too.
 *
 * Wire shape is fixed by specs/ai-gateway/_shared/contract.md 4.6.
 * Behaviour: specs/ai-gateway/guardrail-check-endpoint.feature
 */

import { createLogger } from "@langwatch/observability";
import type { EnabledGuardrailMonitor, MonitorService } from "@langwatch/monitor-contract";
import type { GatewayGuardrailDirection, PrismaClient } from "@langwatch/prisma-client/generated";
import type { EvaluatorTypes, SingleEvaluationResult } from "@langwatch/evaluator-contract";

const logger = createLogger("langwatch:gateway:guardrail-evaluation");

/**
 * The directions the data plane sends, per contract 4.6. These are deliberately
 * not the Prisma enum values: the wire contract and the storage enum are
 * separate vocabularies and conflating them is what broke this endpoint before.
 */
export const GUARDRAIL_WIRE_DIRECTIONS = ["request", "response", "stream_chunk"] as const;

export type GuardrailWireDirection = (typeof GUARDRAIL_WIRE_DIRECTIONS)[number];

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

export function storedDirectionFor(direction: GuardrailWireDirection): GatewayGuardrailDirection {
  return WIRE_DIRECTION_TO_STORED[direction];
}

const ALLOW: GuardrailCheckVerdict = {
  decision: "allow",
  reason: null,
  modified_content: null,
  policies_triggered: [],
};

/**
 * Turn the content the data plane sent into the input/output pair evaluators
 * expect. Request-direction content carries the prompt, response and
 * stream_chunk carry generated text.
 */
export function evaluationDataFor({
  direction,
  content,
}: {
  direction: GuardrailWireDirection;
  content: GuardrailCheckContent | undefined;
}): { input: string; output: string } {
  const asText = (value: unknown): string => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
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
 * The evaluator call is the one boundary this service does not own. Injecting
 * it keeps the scoping, aggregation and failure-mode rules testable against a
 * real database without standing up the evaluator runtime.
 */
export type EvaluatorRunInput = {
  projectId: string;
  evaluatorType: EvaluatorTypes;
  data: { type: "default"; data: { input: string; output: string } };
  settings?: Record<string, unknown>;
};

export type EvaluatorRunner = (args: EvaluatorRunInput) => Promise<SingleEvaluationResult>;

export class GatewayGuardrailEvaluationService {
  private constructor(
    private readonly prisma: PrismaClient,
    private readonly monitors: MonitorService,
    private readonly runEvaluator: EvaluatorRunner,
  ) {}

  static create(
    prisma: PrismaClient,
    monitors: MonitorService,
    runEvaluator: EvaluatorRunner,
  ): GatewayGuardrailEvaluationService {
    return new GatewayGuardrailEvaluationService(prisma, monitors, runEvaluator);
  }

  async check({
    projectId,
    guardrailIds,
    direction,
    content,
  }: {
    projectId: string;
    guardrailIds: string[];
    direction: GuardrailWireDirection;
    content?: GuardrailCheckContent;
  }): Promise<GuardrailCheckVerdict> {
    if (guardrailIds.length === 0) return ALLOW;

    // Scoping by projectId as well as id is what keeps one project's virtual
    // key from naming another project's guardrail.
    const guardrails = await this.prisma.gatewayGuardrail.findMany({
      where: {
        id: { in: guardrailIds },
        projectId,
        archivedAt: null,
        direction: storedDirectionFor(direction),
      },
    });
    if (guardrails.length === 0) return ALLOW;

    const monitorsByEvaluator = await this.guardrailMonitors({
      projectId,
      evaluatorIds: guardrails.map((guardrail) => guardrail.evaluatorId),
    });

    const data = evaluationDataFor({ direction, content });

    const verdicts = await Promise.all(
      guardrails.map(async (guardrail) => {
        const monitor = monitorsByEvaluator.get(guardrail.evaluatorId);
        if (!monitor) {
          // The evaluator lost its AS_GUARDRAIL monitor after the guardrail was
          // created. Treat it exactly like an evaluator error so the failure
          // mode decides, rather than silently allowing.
          return this.onFailure({
            guardrail,
            reason: "guardrail evaluator is not enabled for guardrail execution",
          });
        }
        return this.runOne({ guardrail, monitor, data, projectId });
      }),
    );

    const blocked = verdicts.filter((verdict) => verdict.decision === "block");
    if (blocked.length === 0) return ALLOW;

    return {
      decision: "block",
      reason:
        blocked
          .map((verdict) => verdict.reason)
          .filter(Boolean)
          .join("; ") || null,
      modified_content: null,
      policies_triggered: blocked.flatMap((verdict) => verdict.policies_triggered),
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
  }: {
    guardrail: { id: string; name: string; failureMode: string };
    monitor: EnabledGuardrailMonitor;
    data: { input: string; output: string };
    projectId: string;
  }): Promise<GuardrailCheckVerdict> {
    let result: SingleEvaluationResult;
    try {
      result = await this.runEvaluator({
        projectId,
        evaluatorType: monitor.checkType as EvaluatorTypes,
        data: { type: "default", data },
        settings: (monitor.parameters ?? {}) as Record<string, unknown>,
      });
    } catch (error) {
      logger.warn({ guardrailId: guardrail.id, projectId, error }, "guardrail evaluator threw");
      return this.onFailure({
        guardrail,
        reason: "guardrail evaluator failed to run",
      });
    }

    if (result.status === "error") {
      return this.onFailure({
        guardrail,
        reason: result.details || "guardrail evaluator returned an error",
      });
    }
    if (result.status === "skipped") return ALLOW;
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
    if (guardrail.failureMode === "FAIL_OPEN") return ALLOW;
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
