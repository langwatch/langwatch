/**
 * The evaluator feature's application: what both of its doors call.
 *
 * Evaluators answer over two transports — a project-scoped REST family and the
 * process's tRPC root — and before this each door declared its own bag. The
 * tRPC door wrote `Readonly<{ evaluators: EvaluatorService }>`; the REST family
 * took `evaluators` and `modelProviders` as separate resolver functions the
 * tRPC door could not reach. One object now holds the union.
 *
 * What lives here as a method is what a door would otherwise have to know:
 *
 *   - the evaluator-id scheme, which three call sites minted for themselves;
 *   - "look it up by id, and failing that by slug", the REST reader's rule;
 *   - resolving a project's default and embeddings models when an evaluator is
 *     created without them, and tolerating the absence of an embeddings model;
 *   - refusing a code evaluator whose config carries no program.
 *
 * A caller arrives as an argument, never read from a session or a request.
 */
import {
  codeEvaluatorConfigSchema,
  EvaluatorInvalidConfigError,
  type Evaluator,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorCreateInput,
  type EvaluatorField,
  type EvaluatorHistoryEntry,
  type EvaluatorService,
  type EvaluatorUpdateInput,
  type EvaluatorWithFields,
} from "@langwatch/evaluator-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  ModelNotConfiguredError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { nanoid } from "nanoid";

/**
 * A workflow evaluator was asked to replicate before its workflow was ever
 * saved. The copy would be a structurally broken replica, so the refusal is
 * the caller's to act on: save a version first.
 */
export class EvaluatorWorkflowVersionRequiredError extends HandledError {
  declare readonly code: "evaluator_workflow_version_required";

  constructor(evaluatorId: string) {
    super(
      "evaluator_workflow_version_required",
      "This evaluator's workflow has no saved version",
      { httpStatus: 400, fault: "customer", meta: { evaluatorId } },
    );
    this.name = "EvaluatorWorkflowVersionRequiredError";
  }
}

/** What the process composes this feature's application from. */
export interface EvaluatorAppDependencies {
  evaluators: EvaluatorService;
  /**
   * Resolves the project's default and embeddings models. Only the REST door
   * creates an evaluator without naming them, but the rule for what happens
   * then belongs to the feature, not to that door.
   */
  modelProviders: ModelProviderService;
}

export class EvaluatorApp {
  static create(dependencies: EvaluatorAppDependencies): EvaluatorApp {
    return new EvaluatorApp(dependencies);
  }

  private constructor(private readonly dependencies: EvaluatorAppDependencies) {}

  /**
   * The id a new evaluator gets.
   *
   * One implementation because three used to exist — the REST create, the tRPC
   * input schema and the replication default each minted their own, and an id
   * scheme that is written down three times is one that can diverge.
   */
  newEvaluatorId(): string {
    return `evaluator_${nanoid()}`;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Every evaluator in the project, with its computed input fields. */
  getAllWithFields(input: { projectId: string }): Promise<EvaluatorWithFields[]> {
    return this.dependencies.evaluators.getAllWithFields(input);
  }

  /** One evaluator with its computed fields, or null. */
  tryGetByIdWithFields(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluatorWithFields | null> {
    return this.dependencies.evaluators.tryGetByIdWithFields(input);
  }

  /** One evaluator with its computed fields. */
  getByIdWithFields(input: { id: string; projectId: string }): Promise<EvaluatorWithFields> {
    return this.dependencies.evaluators.getByIdWithFields(input);
  }

  /** One evaluator, or null. */
  tryGetById(input: { id: string; projectId: string }): Promise<Evaluator | null> {
    return this.dependencies.evaluators.tryGetById(input);
  }

  /** One evaluator. */
  getById(input: { id: string; projectId: string }): Promise<Evaluator> {
    return this.dependencies.evaluators.getById(input);
  }

  /** One evaluator by its project-unique slug, or null. */
  tryGetBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | null> {
    return this.dependencies.evaluators.tryGetBySlug(input);
  }

  /**
   * One evaluator addressed the way the public API addresses it: by id, and
   * failing that by slug.
   *
   * The two-step lookup is the feature's rule rather than the REST door's —
   * "the id or the slug" is what an evaluator's public address MEANS, and a
   * door that reimplemented it would answer differently for a slug that looks
   * like an id.
   */
  async tryGetByIdOrSlugWithFields(input: {
    idOrSlug: string;
    projectId: string;
  }): Promise<EvaluatorWithFields | null> {
    const byId = await this.dependencies.evaluators.tryGetByIdWithFields({
      id: input.idOrSlug,
      projectId: input.projectId,
    });
    if (byId) return byId;

    const bySlug = await this.dependencies.evaluators.tryGetBySlug({
      slug: input.idOrSlug,
      projectId: input.projectId,
    });
    if (!bySlug) return null;

    return this.dependencies.evaluators.getByIdWithFields({
      id: bySlug.id,
      projectId: input.projectId,
    });
  }

  /** The evaluator already assigned to this workflow, if there is one. */
  tryGetByWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Evaluator | null> {
    return this.dependencies.evaluators.tryGetByWorkflow(input);
  }

  /** The entry-node fields a workflow evaluator maps trace data onto. */
  getWorkflowFields(input: { id: string; projectId: string }): Promise<{
    evaluatorId: string;
    evaluatorType: string;
    workflowId?: string;
    workflowName?: string;
    workflowIcon?: string;
    fields: EvaluatorField[];
    outputFields: EvaluatorField[];
  }> {
    return this.dependencies.evaluators.getWorkflowFields(input);
  }

  /** The replicas of this evaluator in other projects. */
  getCopies(input: { evaluatorId: string; projectId: string }): Promise<EvaluatorCopy[]> {
    return this.dependencies.evaluators.getCopies(input);
  }

  /** A copy and the evaluator it was copied from. */
  getCopySource(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<{ copy: Evaluator; source: Evaluator }> {
    return this.dependencies.evaluators.getCopySource(input);
  }

  /** Recent audit-log history for one evaluator. */
  getHistory(input: {
    evaluatorId: string;
    projectId: string;
  }): Promise<EvaluatorHistoryEntry[]> {
    return this.dependencies.evaluators.getHistory(input);
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Creates an evaluator, refusing a code evaluator that carries no program. */
  create(input: EvaluatorCreateInput): Promise<Evaluator> {
    if (input.type === "code") assertCodeEvaluatorConfig(input.id, input.config);
    return this.dependencies.evaluators.create(input);
  }

  /**
   * Creates an evaluator against the project's resolved models.
   *
   * The public API names a config but no model, so the project's
   * `evaluator.create_default` model is what the evaluator runs on. The
   * embeddings model is genuinely optional — an evaluator that needs none must
   * still be creatable in a project that has configured none — so its absence
   * is tolerated where the default model's is not.
   */
  async createWithResolvedDefaults(input: {
    projectId: string;
    name: string;
    config: EvaluatorConfig;
    id?: string;
  }): Promise<Evaluator> {
    const [resolvedDefault, resolvedEmbedding] = await Promise.all([
      this.dependencies.modelProviders.resolveModelForFeature({
        projectId: input.projectId,
        featureKey: "evaluator.create_default",
      }),
      this.tryResolveEmbeddingsModel(input.projectId),
    ]);

    return this.dependencies.evaluators.createWithDefaults({
      id: input.id ?? this.newEvaluatorId(),
      projectId: input.projectId,
      name: input.name,
      type: "evaluator",
      config: input.config,
      resolved: {
        defaultModel: resolvedDefault.model,
        embeddingsModel: resolvedEmbedding?.model ?? null,
      },
    });
  }

  /** Updates an evaluator, refusing a code evaluator that carries no program. */
  update(input: EvaluatorUpdateInput): Promise<Evaluator> {
    if (input.data.type === "code" && input.data.config !== undefined) {
      assertCodeEvaluatorConfig(input.id, input.data.config);
    }
    return this.dependencies.evaluators.update(input);
  }

  /** Soft-deletes an evaluator. */
  archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    return this.dependencies.evaluators.archive(input);
  }

  /** Pushes the source evaluator's config onto the named replicas. */
  pushToCopies(input: {
    projectId: string;
    evaluatorId: string;
    copyIds?: string[];
    allowedProjectIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }> {
    return this.dependencies.evaluators.pushToCopies(input);
  }

  /** Pulls a copy back into line with the evaluator it came from. */
  syncFromSource(input: { projectId: string; evaluatorId: string }): Promise<{ ok: true }> {
    return this.dependencies.evaluators.syncFromSource(input);
  }

  /**
   * The service itself, for the one operation that still takes it directly.
   *
   * `EvaluatorReplicationApi` copies an evaluator between projects and is
   * shared with the process's monitor router, so it is constructed per request
   * against ports that resolve from that request. Until it moves out from
   * beside the transports it cannot be a method here, and this getter is the
   * seam that remains — the only place a door reaches past the application.
   */
  get evaluatorService(): EvaluatorService {
    return this.dependencies.evaluators;
  }

  /**
   * The project's embeddings model, or null when it has configured none.
   *
   * A missing embeddings model is a state, not a failure: only some evaluators
   * use one. Every other resolution failure is left to propagate.
   */
  private async tryResolveEmbeddingsModel(
    projectId: string,
  ): Promise<{ model: string } | null> {
    try {
      return await this.dependencies.modelProviders.resolveModelForFeature({
        projectId,
        featureKey: "analytics.topic_clustering_embeddings",
      });
    } catch (error) {
      if (error instanceof ModelNotConfiguredError) return null;
      throw error;
    }
  }
}

/** Code evaluators carry their program on `config`; nothing else can run one. */
function assertCodeEvaluatorConfig(evaluatorId: string, config: unknown): void {
  if (codeEvaluatorConfigSchema.safeParse(config).success) return;
  throw new EvaluatorInvalidConfigError(evaluatorId);
}
