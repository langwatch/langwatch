/**
 * Running a customer's code evaluator on the NLP engine.
 *
 * The dispatch is the Studio one - the same engine, the same `execution`
 * origin, the same causality depth and parent trace - because a code evaluator
 * IS a one-node Studio graph, and giving it a second path would let the two
 * disagree about which trace an evaluation's spans belong to.
 *
 * The engine answers `unknown` and the caller reads three fields off the body.
 * It is PARSED here rather than asserted: a malformed body is a failed
 * evaluation, and the code service already turns a throw from this call into
 * the `CODE_EVALUATOR_ERROR` the customer sees.
 */
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { z } from "zod";

const codeExecutionResponseBodySchema = z.object({
  status: z.string(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      message: z.string().optional(),
      traceback: z.string().optional(),
    })
    .optional(),
});

/**
 * The one capability this module needs from the process's NLP runtime, named
 * structurally: a module server package may not depend on another module's
 * server package, and what this needs is one method rather than a vertical.
 */
export type EvaluatorNlpDispatcher = {
  dispatch(input: {
    projectId: string;
    body: StudioClientEvent;
    origin: "evaluation";
    causalityDepth?: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json(): Promise<unknown>;
  }>;
};

/** One run of a code evaluator, as the code service reads the answer. */
export type EvaluatorCodeExecutionResult = {
  ok: boolean;
  statusText: string;
  body: {
    result?: Record<string, unknown>;
    status: string;
    error?: { message?: string; traceback?: string };
  };
};

/** Where a code evaluator's one-node graph runs. */
export interface EvaluatorCodeExecution {
  execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<EvaluatorCodeExecutionResult>;
}

export class EvaluatorCodeExecutionService implements EvaluatorCodeExecution {
  static create(nlp: EvaluatorNlpDispatcher): EvaluatorCodeExecutionService {
    return new EvaluatorCodeExecutionService(nlp);
  }

  private constructor(private readonly nlp: EvaluatorNlpDispatcher) {}

  async execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<EvaluatorCodeExecutionResult> {
    const response = await this.nlp.dispatch({
      projectId: input.projectId,
      body: input.event,
      origin: "evaluation",
      causalityDepth: input.causalityDepth,
      ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
    });

    return {
      ok: response.ok,
      statusText: response.statusText,
      body: codeExecutionResponseBodySchema.parse(await response.json()),
    };
  }
}
