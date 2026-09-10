/**
 * The evaluator module's application: what both of its doors call - the
 * `/api/evaluators` REST family and the `evaluators.*` tRPC namespace. Every
 * rule either door used to hold is a method here, and a caller arrives as
 * `actorId`, never read from a session or a request.
 */
import type { WorkflowService } from "@langwatch/workflow-server";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  AVAILABLE_EVALUATORS,
  codeEvaluatorConfigSchema,
  EvaluatorApi,
  EvaluatorInvalidConfigError,
  EvaluatorSourcePermissionDeniedError,
  EvaluatorWorkflowEvaluatorExistsError,
  newEvaluatorId,
  type CodeEvaluatorExecutionInput,
  type Evaluator,
  type EvaluatorCascadeArchive,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorCreateInput,
  type EvaluatorHistoryEntry,
  type EvaluatorIdOrSlugInput,
  type EvaluatorPushToCopiesResult,
  type EvaluatorRelatedEntities,
  type EvaluatorResultAugmentationInput,
  type EvaluatorSyncFromSourceResult,
  type EvaluatorUpdateInput,
  type EvaluatorWithFields,
  type EvaluatorWorkflowFields,
  type NativeEvaluatorExecutionInput,
  type ResolvedEvaluatorExecution,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import {
  ModelNotConfiguredError,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";


import type { EvaluatorRepositories } from "../repositories/evaluator.repositories.ts";
import {
  EvaluatorCodeExecutionService,
  type EvaluatorNlpDispatcher,
} from "../services/evaluator-code-execution.service.ts";
import { EvaluatorHistoryService } from "../services/evaluator-history.service.ts";
import { EvaluatorReplicationService } from "../services/evaluator-replication.service.ts";
import { EvaluatorService as EvaluatorRuntimeService } from "../services/evaluator.service.ts";

/**
 * The workflow and monitor rows an evaluator is entangled with. Both belong to
 * other modules, so the process reads and writes them; this module only says
 * what it needs of them.
 */
export interface EvaluatorGraph {
  /** The evaluator's linked workflow, scoped to the project and not archived. */
  findLinkedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<{ id: string; name: string } | null>;
  /** The monitors in the project that run this evaluator. */
  findMonitorsUsingEvaluator(
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ id: string; name: string }[]>;
  /** Hard-deletes those monitors, and answers how many went. */
  deleteMonitorsUsingEvaluator(
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ count: number }>;
  /** Archives the evaluator's linked workflow. */
  archiveLinkedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<{ id: string }>;
  /** Clones a workflow evaluator's workflow into the target project. */
  replicateEvaluatorWorkflow(
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actorId: string;
    }>,
  ): Promise<string>;
  /** Removes a workflow a replication created, when the evaluator insert fails. */
  deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}

/**
 * Ports the process supplies. `workflows` and `modelProviders` still carry a
 * peer module's own service rather than its API token, because `WorkflowApi`
 * publishes neither `getFields` nor `enrichStudioEvent` and `ModelProviderApi`
 * is a strict superset of the service the api composes. `graph` is a row no
 * module's api publishes yet. Narrowing the three onto tokens is the
 * peer-narrowing wave, not this one.
 */
export interface EvaluatorAppInfrastructure {
  /** The workflow rows an evaluator's fields, its guard and its run read. */
  workflows: WorkflowService;
  /** The workflow and monitor rows an evaluator is entangled with. */
  graph: EvaluatorGraph;
  /** Where a code evaluator's one-node Studio graph runs. */
  nlp: EvaluatorNlpDispatcher;
  /**
   * Resolves the project's default and embeddings models. Only the REST door
   * creates an evaluator without naming them, but the rule for what happens
   * then belongs to the module, not to that door.
   */
  modelProviders: ModelProviderApi;
  /** The models a deployment falls back to when a project configured none. */
  fallbackModels?: Readonly<{ defaultModel: string; embeddingsModel: string }> | undefined;
  /** Mints the ephemeral studio ids a code evaluator's run is traced under. */
  generateId: () => string;
}

type EvaluatorSetup = FeatureSetup<
  typeof EvaluatorApp.dependencies,
  EvaluatorAppInfrastructure,
  undefined,
  EvaluatorRepositories
>;

/** What the app is built from, once the setup has assembled it. */
type EvaluatorAppParts = Readonly<{
  evaluators: EvaluatorRuntimeService;
  modelProviders: ModelProviderApi;
  permissions: AuthzApi;
  graph: EvaluatorGraph;
}>;

export class EvaluatorApp implements EvaluatorApi {
  static readonly contract = EvaluatorApi;
  static readonly dependencies = {
    /** Answers whether the caller may act in a project that is not the request's. */
    permissions: AuthzApi,
    /** The trail one evaluator's change history is read off. */
    auditLog: AuditLogApi,
    /** Names the person behind each row of that history. */
    users: UserApi,
  };

  static create(setup: EvaluatorSetup): EvaluatorApp {
    const { dependencies, members, repositories } = setup;

    return new EvaluatorApp({
      evaluators: EvaluatorRuntimeService.create({
        repository: repositories.evaluators,
        workflows: members.workflows,
        history: EvaluatorHistoryService.create({
          auditLog: dependencies.auditLog,
          users: dependencies.users,
        }),
        ...(members.fallbackModels
          ? { fallbackModels: members.fallbackModels }
          : {}),
        codeExecution: EvaluatorCodeExecutionService.create(members.nlp),
        generateId: members.generateId,
      }),
      modelProviders: members.modelProviders,
      permissions: dependencies.permissions,
      graph: members.graph,
    });
  }

  #dependencies: EvaluatorAppParts;

  private constructor(dependencies: EvaluatorAppParts) {
    this.#dependencies = dependencies;
  }

  /** Runs a code evaluator's program in the process's own code sandbox. */
  executeCode(input: CodeEvaluatorExecutionInput): Promise<SingleEvaluationResult> {
    return this.#dependencies.evaluators.executeCode(input);
  }

  /** Runs a native evaluator through the NLP engine. */
  executeNative(input: NativeEvaluatorExecutionInput): Promise<SingleEvaluationResult> {
    return this.#dependencies.evaluators.executeNative(input);
  }

  /** Reshapes a native evaluator's raw result onto mapped data and dropped categories. */
  augmentResult(input: EvaluatorResultAugmentationInput): SingleEvaluationResult {
    return this.#dependencies.evaluators.augmentResult(input);
  }

  /** Resolves an evaluator by id or slug into what running it needs. */
  resolveForExecution(input: EvaluatorIdOrSlugInput): Promise<ResolvedEvaluatorExecution> {
    return this.#dependencies.evaluators.resolveForExecution(input);
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

  /** One evaluator by its project-unique slug. */
  getBySlug(input: { slug: string; projectId: string }): Promise<Evaluator> {
    return this.#dependencies.evaluators.getBySlug(input);
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

  /** Creates an evaluator against models already resolved by the caller. */
  createWithDefaults(input: EvaluatorCreateInput): Promise<Evaluator> {
    return this.#dependencies.evaluators.createWithDefaults(input);
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
   * Pushes the source evaluator's config onto the named replicas, but only
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
