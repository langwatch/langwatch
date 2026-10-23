/** Customer code evaluator on NLP engine; dispatch uses Studio path for trace consistency. */
import type {
  StudioClientEvent,
  WorkflowApi,
  WorkflowRunAnswer,
} from "@langwatch/workflow-contract";

/** The one workflow operation a code evaluator's run needs. */
type EvaluatorStudioRunner = Pick<WorkflowApi, "executeStudioEventSync">;

/** Where a code evaluator's one-node graph runs; an engine refusal throws a handled error. */
export interface EvaluatorCodeExecution {
  execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<WorkflowRunAnswer>;
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

  execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<WorkflowRunAnswer> {
    return this.workflows.executeStudioEventSync({
      projectId: input.projectId,
      event: input.event,
      origin: "evaluation",
      causalityDepth: input.causalityDepth,
      ...(input.parentTrace ? { parentTrace: input.parentTrace } : {}),
    });
  }
}
