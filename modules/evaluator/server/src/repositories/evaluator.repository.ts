import type {
  Evaluator,
  EvaluatorConfig,
  EvaluatorCopy,
  EvaluatorUpdateInput,
} from "@langwatch/evaluator-contract";

/** One evaluator row as it is written; the slug is derived when omitted. */
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

/** The evaluator rows a project owns. Absence is an answer, never a refusal. */
export interface EvaluatorRepository {
  findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined>;
  /**
   * One evaluator by id alone. Reading a copy's source crosses the project
   * boundary on purpose: the source lives in the project it was copied from.
   */
  findByIdAcrossProjects(id: string): Promise<Evaluator | undefined>;
  findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined>;
  findByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator | undefined>;
  /** The public address: the id, and failing that the project-unique slug. */
  findByIdOrSlug(input: { idOrSlug: string; projectId: string }): Promise<Evaluator | undefined>;
  findAll(input: { projectId: string }): Promise<Evaluator[]>;
  findCopies(input: { evaluatorId: string }): Promise<EvaluatorCopy[]>;
  create(input: PersistEvaluatorInput): Promise<Evaluator>;
  update(input: EvaluatorUpdateInput): Promise<Evaluator>;
  archive(input: { id: string; projectId: string }): Promise<Evaluator>;
  updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: EvaluatorConfig;
  }): Promise<void>;
}
