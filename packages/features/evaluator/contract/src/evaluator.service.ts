import type { Evaluator, EvaluatorConfig, EvaluatorField, EvaluatorWithFields } from "./evaluator";
import type { CodeEvaluatorExecutionInput } from "./code-evaluator";
import type { SingleEvaluationResult } from "./evaluators.generated";
import type { EvaluatorIdOrSlugInput, ResolvedEvaluatorExecution } from "./evaluator-execution";

export type EvaluatorCreateInput = {
  id: string;
  projectId: string;
  name: string;
  slug?: string;
  type: "evaluator" | "code" | "workflow";
  config: EvaluatorConfig;
  workflowId?: string;
  copiedFromEvaluatorId?: string;
  resolved?: { defaultModel?: string | null; embeddingsModel?: string | null };
};
export type EvaluatorUpdateInput = {
  id: string;
  projectId: string;
  data: Partial<Pick<Evaluator, "name" | "type" | "workflowId">> & {
    config?: EvaluatorConfig;
  };
};
export type EvaluatorCopy = {
  id: string;
  name: string;
  projectId: string;
  fullPath: string;
};
export type EvaluatorHistoryEntry = {
  id: string;
  action: string;
  createdAt: Date;
  args: unknown;
  user: { id: string; name: string | null; email: string | null } | null;
};
export type WorkflowEvaluatorFields = {
  workflowId: string;
  workflowName: string;
  workflowIcon?: string;
  fields: EvaluatorField[];
  outputFields: EvaluatorField[];
};

export type NativeEvaluatorExecutionInput = {
  evaluatorType: string;
  data: Record<string, unknown>;
};

export type EvaluatorResultAugmentationInput = {
  evaluatorType: string;
  mappedData: Record<string, unknown>;
  settings: Record<string, unknown> | undefined;
  droppedCategories: string[];
  result: SingleEvaluationResult;
};

export abstract class EvaluatorService {
  abstract executeCode(input: CodeEvaluatorExecutionInput): Promise<SingleEvaluationResult>;
  abstract executeNative(input: NativeEvaluatorExecutionInput): Promise<SingleEvaluationResult>;
  abstract augmentResult(input: EvaluatorResultAugmentationInput): SingleEvaluationResult;
  abstract tryGetById(input: { id: string; projectId: string }): Promise<Evaluator | null>;
  abstract getById(input: { id: string; projectId: string }): Promise<Evaluator>;
  abstract tryGetByIdWithFields(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluatorWithFields | null>;
  abstract getByIdWithFields(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluatorWithFields>;
  abstract resolveForExecution(input: EvaluatorIdOrSlugInput): Promise<ResolvedEvaluatorExecution>;
  abstract tryGetBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | null>;
  abstract tryGetByWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Evaluator | null>;
  abstract getBySlug(input: { slug: string; projectId: string }): Promise<Evaluator>;
  abstract getAll(input: { projectId: string }): Promise<Evaluator[]>;
  abstract getAllWithFields(input: { projectId: string }): Promise<EvaluatorWithFields[]>;
  abstract create(input: EvaluatorCreateInput): Promise<Evaluator>;
  abstract createWithDefaults(input: EvaluatorCreateInput): Promise<Evaluator>;
  abstract update(input: EvaluatorUpdateInput): Promise<Evaluator>;
  abstract archive(input: { id: string; projectId: string }): Promise<Evaluator>;
  abstract getWorkflowFields(input: { id: string; projectId: string }): Promise<{
    evaluatorId: string;
    evaluatorType: string;
    workflowId?: string;
    workflowName?: string;
    workflowIcon?: string;
    fields: EvaluatorField[];
    outputFields: EvaluatorField[];
  }>;
  abstract getCopies(input: { evaluatorId: string; projectId: string }): Promise<EvaluatorCopy[]>;
  abstract pushToCopies(input: {
    projectId: string;
    evaluatorId: string;
    copyIds?: string[];
    allowedProjectIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }>;
  abstract syncFromSource(input: { projectId: string; evaluatorId: string }): Promise<{ ok: true }>;
  abstract getCopySource(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<{ copy: Evaluator; source: Evaluator }>;
  abstract getHistory(input: {
    evaluatorId: string;
    projectId: string;
  }): Promise<EvaluatorHistoryEntry[]>;
}
