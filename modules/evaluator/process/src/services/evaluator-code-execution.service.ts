/** Customer code evaluator on NLP engine; dispatch uses Studio path for trace consistency. */
import type { StudioClientEvent, WorkflowApi } from "@langwatch/workflow-contract";
import { z } from "zod";

const codeExecutionResponseBodySchema = z.object({
  status: z.string(),
  result: z.record(z.string(), z.unknown()).nullish(),
  error: z
    .object({
      message: z.string().optional(),
      traceback: z.string().optional(),
    })
    .optional(),
});

/** The one workflow operation a code evaluator's run needs. */
type EvaluatorStudioRunner = Pick<WorkflowApi, "executeStudioEventSync">;

/** One run of a code evaluator, as the code service reads the answer. */
type EvaluatorCodeExecutionResult = {
  ok: boolean;
  statusText: string;
  body: {
    result?: Record<string, unknown> | null;
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
  static create({
    workflows,
  }: {
    workflows: EvaluatorStudioRunner;
  }): EvaluatorCodeExecutionService {
    return new EvaluatorCodeExecutionService(workflows);
  }

  private constructor(private readonly workflows: EvaluatorStudioRunner) {}

  async execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<EvaluatorCodeExecutionResult> {
    const response = await this.workflows.executeStudioEventSync({
      projectId: input.projectId,
      event: input.event,
      origin: "evaluation",
      causalityDepth: input.causalityDepth,
      ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
    });

    return {
      ok: response.ok,
      statusText: response.statusText,
      body: response.ok
        ? codeExecutionResponseBodySchema.parse(response.body)
        : { status: "error", error: { message: response.statusText } },
    };
  }
}
