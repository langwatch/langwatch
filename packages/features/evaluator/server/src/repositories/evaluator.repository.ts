import type {
  Evaluator,
  EvaluatorConfig,
  EvaluatorCopy,
  EvaluatorUpdateInput,
} from "@langwatch/evaluator-contract";

/** The persistence surface consumed by the private Postgres adapter. */
export type EvaluatorDatabase = {
  evaluator: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

export type PersistEvaluatorInput = {
  id: string;
  projectId: string;
  name: string;
  slug?: string;
  type: Evaluator["type"];
  config: EvaluatorConfig;
  workflowId?: string;
  copiedFromEvaluatorId?: string;
};

export abstract class EvaluatorRepository {
  abstract tryFindById(input: { id: string; projectId: string }): Promise<Evaluator | null>;
  abstract findById(input: { id: string; projectId: string }): Promise<Evaluator>;
  abstract tryFindByIdOnly(id: string): Promise<Evaluator | null>;
  abstract tryFindBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | null>;
  abstract tryFindByWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Evaluator | null>;
  abstract findByIdOrSlug(input: { idOrSlug: string; projectId: string }): Promise<Evaluator>;
  abstract findAll(input: { projectId: string }): Promise<Evaluator[]>;
  abstract create(input: PersistEvaluatorInput): Promise<Evaluator>;
  abstract update(input: EvaluatorUpdateInput): Promise<Evaluator>;
  abstract archive(input: { id: string; projectId: string }): Promise<Evaluator>;
  abstract findCopies(input: { evaluatorId: string }): Promise<EvaluatorCopy[]>;
  abstract updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: EvaluatorConfig;
  }): Promise<void>;
}
