import type { Evaluator, PrismaClient } from "@prisma/client";
import type { Workflow } from "~/optimization_studio/types/dsl";
import {
  getWorkflowEndInputs,
  getWorkflowEntryOutputs,
} from "~/optimization_studio/utils/workflowFields";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import {
  type CreateEvaluatorInput,
  EvaluatorRepository,
} from "./evaluator.repository";

// ============================================================================
// Types
// ============================================================================

/**
 * Field definition for an evaluator input.
 * Used by frontend for mapping UI and validation.
 */
export interface EvaluatorField {
  identifier: string;
  type: string;
  optional?: boolean;
}

/**
 * Evaluator with computed fields.
 * This is what the API returns - the raw Evaluator plus derived fields.
 */
export type EvaluatorWithFields = Evaluator & {
  /** Input fields required by the evaluator */
  fields: EvaluatorField[];
  /** Output fields produced by the evaluator (for evaluator-as-target mapping) */
  outputFields: EvaluatorField[];
  /** Workflow name (only for workflow evaluators) */
  workflowName?: string;
  /** Workflow icon (only for workflow evaluators) */
  workflowIcon?: string;
};

/**
 * Standard output fields for built-in evaluators.
 * All built-in evaluators produce these fields.
 */
const STANDARD_EVALUATOR_OUTPUT_FIELDS: EvaluatorField[] = [
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
  { identifier: "details", type: "str" },
];

// ============================================================================
// Field Type Mapping
// ============================================================================

/**
 * Maps evaluator field names to their correct types.
 * Most fields are "str" but some like "contexts" are lists.
 */
const FIELD_TYPE_MAP: Record<string, string> = {
  contexts: "list",
  expected_contexts: "list",
  conversation: "list",
};

function getFieldType(fieldName: string): string {
  return FIELD_TYPE_MAP[fieldName] ?? "str";
}

// ============================================================================
// Service
// ============================================================================

/**
 * Service layer for Evaluator business logic.
 * Single Responsibility: Evaluator lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class EvaluatorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: EvaluatorRepository,
  ) {}

  /**
   * Static factory method for creating an EvaluatorService with proper DI.
   */
  static create(prisma: PrismaClient): EvaluatorService {
    const repository = new EvaluatorRepository(prisma);
    return new EvaluatorService(prisma, repository);
  }

  /**
   * Computes fields for a built-in evaluator from AVAILABLE_EVALUATORS.
   */
  private computeBuiltInFields(evaluatorType: string): EvaluatorField[] {
    const def = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
    if (!def) return [];

    const requiredFields = def.requiredFields ?? [];
    const optionalFields = def.optionalFields ?? [];

    return [
      ...requiredFields.map((fieldName) => ({
        identifier: fieldName,
        type: getFieldType(fieldName),
      })),
      ...optionalFields.map((fieldName) => ({
        identifier: fieldName,
        type: getFieldType(fieldName),
        optional: true,
      })),
    ];
  }

  /**
   * Result from computing workflow fields, includes metadata about the workflow.
   */
  private async computeWorkflowFieldsWithMeta(workflowId: string): Promise<{
    fields: EvaluatorField[];
    outputFields: EvaluatorField[];
    workflowName?: string;
    workflowIcon?: string;
  }> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { currentVersion: true },
    });

    if (!workflow?.currentVersion?.dsl) {
      return {
        fields: [],
        outputFields: STANDARD_EVALUATOR_OUTPUT_FIELDS,
        workflowName: workflow?.name,
      };
    }

    const dsl = workflow.currentVersion.dsl as unknown as Workflow;
    const entryOutputs = getWorkflowEntryOutputs(dsl);
    const endInputs = getWorkflowEndInputs(dsl);

    const fields = entryOutputs.map((output) => ({
      identifier: output.identifier,
      type: output.type,
      // Workflow fields are all required (no optional flag)
    }));

    // For workflow evaluators, output fields come from the End node inputs
    // If no End node inputs are defined, fall back to standard evaluator outputs
    const outputFields =
      endInputs.length > 0
        ? endInputs.map((input) => ({
            identifier: input.identifier,
            type: input.type,
          }))
        : STANDARD_EVALUATOR_OUTPUT_FIELDS;

    return {
      fields,
      outputFields,
      workflowName: workflow.name,
      workflowIcon: (dsl as { icon?: string }).icon,
    };
  }

  /**
   * Enriches an evaluator with its computed fields and workflow metadata.
   */
  async enrichWithFields(evaluator: Evaluator): Promise<EvaluatorWithFields> {
    if (evaluator.type === "workflow" && evaluator.workflowId) {
      const { fields, outputFields, workflowName, workflowIcon } =
        await this.computeWorkflowFieldsWithMeta(evaluator.workflowId);
      return { ...evaluator, fields, outputFields, workflowName, workflowIcon };
    }

    const config = evaluator.config as { evaluatorType?: string } | null;
    const evaluatorType = config?.evaluatorType;
    const fields = evaluatorType ? this.computeBuiltInFields(evaluatorType) : [];

    // Built-in evaluators always have standard output fields
    return {
      ...evaluator,
      fields,
      outputFields: STANDARD_EVALUATOR_OUTPUT_FIELDS,
    };
  }

  /**
   * Gets an evaluator by ID with computed fields.
   */
  async getByIdWithFields(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluatorWithFields | null> {
    const evaluator = await this.repository.findById(input);
    if (!evaluator) return null;
    return this.enrichWithFields(evaluator);
  }

  /**
   * Gets all evaluators for a project with computed fields.
   */
  async getAllWithFields(input: {
    projectId: string;
  }): Promise<EvaluatorWithFields[]> {
    const evaluators = await this.repository.findAll(input);
    return Promise.all(evaluators.map((e) => this.enrichWithFields(e)));
  }

  /**
   * Gets an evaluator by ID.
   */
  get getById() {
    return this.repository.findById.bind(this.repository);
  }

  /**
   * Gets an evaluator by slug.
   */
  get getBySlug() {
    return this.repository.findBySlug.bind(this.repository);
  }

  /**
   * Gets all evaluators for a project.
   */
  get getAll() {
    return this.repository.findAll.bind(this.repository);
  }

  /**
   * Creates a new evaluator.
   */
  get create() {
    return this.repository.create.bind(this.repository);
  }

  /**
   * Updates an existing evaluator.
   */
  get update() {
    return this.repository.update.bind(this.repository);
  }

  /**
   * Soft deletes an evaluator.
   */
  get softDelete() {
    return this.repository.softDelete.bind(this.repository);
  }
}
