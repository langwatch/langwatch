/**
 * Running a customer's code evaluator on the NLP engine.
 *
 * Moved from the platform app's `runtime/app/features/evaluator.ts`. The
 * dispatch is the Studio one — the same engine, the same `execution` origin,
 * the same causality depth and parent trace — because a code evaluator IS a
 * one-node Studio graph, and giving it a second path would let the two disagree
 * about which trace an evaluation's spans belong to.
 *
 * The engine answers `unknown` and the port promises a shape the code
 * evaluator reads three fields off. It is PARSED here rather than asserted: a
 * malformed body is a failed evaluation, and the service already turns a throw
 * from this call into the `CODE_EVALUATOR_ERROR` the customer sees.
 */
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { z } from "zod";
import { EvaluatorCodeExecutionPort } from "../ports/evaluator.port";

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
 * The one capability this adapter needs from the workflow feature's NLP
 * runtime, named structurally.
 *
 * Structural rather than the `WorkflowNlpRuntimePort` class itself: a feature
 * server package may not depend on another feature's server package, and what
 * this needs is one method rather than a vertical.
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

export class NlpEvaluatorCodeExecutionAdapter extends EvaluatorCodeExecutionPort {
  static create(nlp: EvaluatorNlpDispatcher): NlpEvaluatorCodeExecutionAdapter {
    return new NlpEvaluatorCodeExecutionAdapter(nlp);
  }

  private constructor(private readonly nlp: EvaluatorNlpDispatcher) {
    super();
  }

  async execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }) {
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
