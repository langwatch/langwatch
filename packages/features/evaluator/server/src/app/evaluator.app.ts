/**
 * The evaluator feature's application: what both of its doors call — the
 * `/api/evaluators` REST family and the `evaluators.*` tRPC namespace. Every
 * rule either door used to hold is a method here, and a caller arrives as
 * `actorId`, never read from a session or a request.
 */
import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  AVAILABLE_EVALUATORS,
  codeEvaluatorConfigSchema,
  EvaluatorApi,
  EvaluatorInvalidConfigError,
  EvaluatorSourcePermissionDeniedError,
  EvaluatorWorkflowEvaluatorExistsError,
  newEvaluatorId,
  type Evaluator,
  type EvaluatorCascadeArchive,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorCreateInput,
  type EvaluatorHistoryEntry,
  type EvaluatorPushToCopiesResult,
  type EvaluatorRelatedEntities,
  type EvaluatorService,
  type EvaluatorSyncFromSourceResult,
  type EvaluatorUpdateInput,
  type EvaluatorWithFields,
  type EvaluatorWorkflowFields,
} from "@langwatch/evaluator-contract";
import {
  ModelNotConfiguredError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";

import type { EvaluatorGraphPort } from "../ports/evaluator.port.ts";
import { EvaluatorReplicationService } from "../services/evaluator-replication.service.ts";

/** What the process composes this feature's application from. */
export interface EvaluatorAppDependencies {
  evaluators: EvaluatorService;
  /**
   * Resolves the project's default and embeddings models. Only the REST door
   * creates an evaluator without naming them, but the rule for what happens
   * then belongs to the feature, not to that door.
   */
  modelProviders: ModelProviderService;
  /** Answers whether the caller may act in a project that is not the request's. */
  permissions: AuthzApi;
  /** The workflow and monitor rows an evaluator is entangled with. */
  graph: EvaluatorGraphPort;
}

export class EvaluatorApp implements EvaluatorApi {
  static readonly contract = EvaluatorApi;
  static create(dependencies: EvaluatorAppDependencies): EvaluatorApp {
    return new EvaluatorApp(dependencies);
  }

  #dependencies: EvaluatorAppDependencies;

  private constructor(dependencies: EvaluatorAppDependencies) {
    this.#dependencies = dependencies;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  getAll(input: { projectId: string }): Promise<Evaluator[]> {
    return this.#dependencies.evaluators.getAll(input);
  }

  /** Every evaluator in the project, with its computed input fields. */
  getAllWithFields(input: { projectId: string }): Promise<EvaluatorWithFields[]> {
    return this.#dependencies.evaluators.getAllWithFields(input);
  }

  /** One evaluator with its computed fields, or undefined. */
  async findByIdWithFields(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluatorWithFields | undefined> {
    return (await this.#dependencies.evaluators.tryGetByIdWithFields(input)) ?? void 0;
  }

  /** One evaluator with its computed fields. */
  getByIdWithFields(input: { id: string; projectId: string }): Promise<EvaluatorWithFields> {
    return this.#dependencies.evaluators.getByIdWithFields(input);
  }

  /** One evaluator, or undefined. */
  async findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined> {
    return (await this.#dependencies.evaluators.tryGetById(input)) ?? void 0;
  }

  /** One evaluator. */
  getById(input: { id: string; projectId: string }): Promise<Evaluator> {
    return this.#dependencies.evaluators.getById(input);
  }

  /** One evaluator by its project-unique slug, or undefined. */
  async findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined> {
    return (await this.#dependencies.evaluators.tryGetBySlug(input)) ?? void 0;
  }

  /**
   * One evaluator addressed the way the public API addresses it: by id, and
   * failing that by slug. The two-step lookup is the feature's rule rather than
   * the REST door's, and a door that reimplemented it would answer differently
   * for a slug that looks like an id.
   */
  async findByIdOrSlugWithFields(input: {
    idOrSlug: string;
    projectId: string;
  }): Promise<EvaluatorWithFields | undefined> {
    const byId = await this.findByIdWithFields({
      id: input.idOrSlug,
      projectId: input.projectId,
    });
    if (byId) return byId;

    const bySlug = await this.findBySlug({
      slug: input.idOrSlug,
      projectId: input.projectId,
    });
    if (!bySlug) return void 0;

    return this.#dependencies.evaluators.getByIdWithFields({
      id: bySlug.id,
      projectId: input.projectId,
    });
  }

  /** The evaluator already assigned to this workflow, if there is one. */
  async listByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator[]> {
    const evaluator = await this.#dependencies.evaluators.tryGetByWorkflow(input);

    return evaluator ? [evaluator] : [];
  }

  /** The entry-node fields a workflow evaluator maps trace data onto. */
  getWorkflowFields(input: { id: string; projectId: string }): Promise<EvaluatorWorkflowFields> {
    return this.#dependencies.evaluators.getWorkflowFields(input);
  }

  /** The workflow and monitors a cascade archive would take with the evaluator. */
  async getRelatedEntities(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluatorRelatedEntities> {
    const evaluator = await this.findById(input);
    const workflow = evaluator?.workflowId
      ? await this.#dependencies.graph.findLinkedWorkflow({
          workflowId: evaluator.workflowId,
          projectId: input.projectId,
        })
      : null;
    const monitors = await this.#dependencies.graph.findMonitorsUsingEvaluator({
      evaluatorId: input.id,
      projectId: input.projectId,
    });

    return { workflow, monitors };
  }

  /**
   * The replicas of this evaluator the caller may read. A replica lives in
   * another project, so the list is filtered by what the caller holds THERE.
   */
  async getCopies(input: {
    evaluatorId: string;
    projectId: string;
    actorId: string;
  }): Promise<EvaluatorCopy[]> {
    const copies = await this.#dependencies.evaluators.getCopies(input);

    return this.#reachable(copies, input.actorId, "evaluations:view");
  }

  /** A copy and the evaluator it was copied from. */
  getCopySource(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<{ copy: Evaluator; source: Evaluator }> {
    return this.#dependencies.evaluators.getCopySource(input);
  }

  /** Recent audit-log history for one evaluator. */
  getHistory(input: { evaluatorId: string; projectId: string }): Promise<EvaluatorHistoryEntry[]> {
    return this.#dependencies.evaluators.getHistory(input);
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Creates an evaluator, refusing a code evaluator that carries no program and
   * a workflow that already answers for one.
   */
  async create(input: EvaluatorCreateInput): Promise<Evaluator> {
    if (input.type === "code") assertCodeEvaluatorConfig(input.id, input.config);

    if (input.workflowId) {
      const [existing] = await this.listByWorkflow({
        workflowId: input.workflowId,
        projectId: input.projectId,
      });

      if (existing) {
        throw new EvaluatorWorkflowEvaluatorExistsError({
          workflowId: input.workflowId,
          evaluatorName: existing.name,
        });
      }
    }

    return this.#dependencies.evaluators.create(input);
  }

  /**
   * Creates an evaluator against the project's resolved models: the public API
   * names a config but no model, so `evaluator.create_default` is what it runs
   * on. The embeddings model is optional where the default model is not.
   */
  async createWithResolvedDefaults(input: {
    projectId: string;
    name: string;
    config: EvaluatorConfig;
    id?: string;
  }): Promise<Evaluator> {
    const [resolvedDefault, resolvedEmbedding] = await Promise.all([
      this.#dependencies.modelProviders.resolveModelForFeature({
        projectId: input.projectId,
        featureKey: "evaluator.create_default",
      }),
      this.#resolveEmbeddingsModel(input.projectId, input.config),
    ]);

    return this.#dependencies.evaluators.createWithDefaults({
      id: input.id ?? newEvaluatorId(),
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
  async update(input: EvaluatorUpdateInput): Promise<Evaluator> {
    if (input.data.type === "code" && input.data.config !== void 0) {
      assertCodeEvaluatorConfig(input.id, input.data.config);
    }

    return this.#dependencies.evaluators.update(input);
  }

  /** Soft-deletes an evaluator. */
  archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    return this.#dependencies.evaluators.archive(input);
  }

  /**
   * Archives the evaluator and everything that only exists to run it: the
   * monitors go (hard, they are configuration), the linked workflow is archived
   * beside the evaluator.
   */
  async cascadeArchive(input: { id: string; projectId: string }): Promise<EvaluatorCascadeArchive> {
    const evaluator = await this.#dependencies.evaluators.getById(input);
    const deletedMonitors = await this.#dependencies.graph.deleteMonitorsUsingEvaluator({
      evaluatorId: input.id,
      projectId: input.projectId,
    });
    const archivedEvaluator = await this.#dependencies.evaluators.archive(input);
    const archivedWorkflow = evaluator.workflowId
      ? await this.#dependencies.graph.archiveLinkedWorkflow({
          workflowId: evaluator.workflowId,
          projectId: input.projectId,
        })
      : null;

    return {
      evaluator: archivedEvaluator,
      archivedWorkflow,
      deletedMonitorsCount: deletedMonitors.count,
    };
  }

  /** Replicates the evaluator, and the workflow backing it, into another project. */
  async copy(input: {
    evaluatorId: string;
    projectId: string;
    sourceProjectId: string;
    newEvaluatorId: string;
    actorId: string;
  }): Promise<Evaluator> {
    const permitted = await this.#dependencies.permissions.hasPermission({
      userId: input.actorId,
      permission: "evaluations:manage",
      projectId: input.sourceProjectId,
    });

    if (!permitted) throw new EvaluatorSourcePermissionDeniedError(input.sourceProjectId);

    return EvaluatorReplicationService.create({
      replicateEvaluatorWorkflow: (replication) =>
        this.#dependencies.graph.replicateEvaluatorWorkflow({
          ...replication,
          actorId: input.actorId,
        }),
      deleteReplicatedWorkflow: (replication) =>
        this.#dependencies.graph.deleteReplicatedWorkflow(replication),
    }).copyToProject({
      evaluators: this,
      evaluatorId: input.evaluatorId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.projectId,
      newEvaluatorId: input.newEvaluatorId,
    });
  }

  /**
   * Pushes the source evaluator's config onto the named replicas — but only
   * into the projects the caller may write, which the service is told rather
   * than left to assume.
   */
  async pushToCopies(input: {
    projectId: string;
    evaluatorId: string;
    copyIds?: string[];
    actorId: string;
  }): Promise<EvaluatorPushToCopiesResult> {
    const copies = await this.#dependencies.evaluators.getCopies(input);
    const selected = input.copyIds
      ? copies.filter((copy) => input.copyIds?.includes(copy.id))
      : copies;
    const writable = await this.#reachable(selected, input.actorId, "evaluations:manage");

    return this.#dependencies.evaluators.pushToCopies({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      ...(input.copyIds !== void 0 && { copyIds: input.copyIds }),
      allowedProjectIds: writable.map((copy) => copy.projectId),
    });
  }

  /** Pulls a copy back into line with the evaluator it came from. */
  async syncFromSource(input: {
    projectId: string;
    evaluatorId: string;
    actorId: string;
  }): Promise<EvaluatorSyncFromSourceResult> {
    const { source } = await this.#dependencies.evaluators.getCopySource(input);
    const permitted = await this.#dependencies.permissions.hasPermission({
      userId: input.actorId,
      permission: "evaluations:manage",
      projectId: source.projectId,
    });

    if (!permitted) {
      throw new PermissionDeniedError({
        permission: "evaluations:manage",
        scope: { type: "project", id: source.projectId },
        denialReason: "no-binding",
      });
    }

    return this.#dependencies.evaluators.syncFromSource({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
    });
  }

  /** The copies whose own project the caller holds `permission` on. */
  async #reachable(
    copies: EvaluatorCopy[],
    actorId: string,
    permission: "evaluations:view" | "evaluations:manage",
  ): Promise<EvaluatorCopy[]> {
    const decisions = await Promise.all(
      copies.map((copy) =>
        this.#dependencies.permissions.hasPermission({
          userId: actorId,
          permission,
          projectId: copy.projectId,
        }),
      ),
    );

    return copies.filter((_, index) => decisions[index] === true);
  }

  /**
   * The project's embeddings model, or null when it configured none AND the
   * evaluator being created declares none (#7556). For a type that DOES
   * declare one the absence stays a failure: swallowing it fills the field
   * from the catalog fallback and the evaluator fails at RUN time instead.
   */
  async #resolveEmbeddingsModel(
    projectId: string,
    config: EvaluatorConfig,
  ): Promise<{ model: string } | null> {
    try {
      return await this.#dependencies.modelProviders.resolveModelForFeature({
        projectId,
        featureKey: "analytics.topic_clustering_embeddings",
      });
    } catch (error) {
      if (error instanceof ModelNotConfiguredError && !usesEmbeddingsModel(config)) return null;
      throw error;
    }
  }
}

/** Whether the evaluator type's own settings declare an embeddings model. */
function usesEmbeddingsModel(config: EvaluatorConfig): boolean {
  const evaluatorType = typeof config.evaluatorType === "string" ? config.evaluatorType : void 0;
  if (!evaluatorType) return false;

  const definition = AVAILABLE_EVALUATORS[evaluatorType as keyof typeof AVAILABLE_EVALUATORS];
  if (!definition || !("settings" in definition)) return false;

  return "embeddings_model" in definition.settings;
}

/** Code evaluators carry their program on `config`; nothing else can run one. */
function assertCodeEvaluatorConfig(evaluatorId: string, config: unknown): void {
  if (codeEvaluatorConfigSchema.safeParse(config).success) return;

  throw new EvaluatorInvalidConfigError(evaluatorId);
}
