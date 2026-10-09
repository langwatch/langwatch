/**
 * The evaluator module's application: what both doors call — the
 * `/api/evaluators` REST family and `evaluators.*` tRPC. A caller arrives
 * as `actorId`, never read from a session or a request here.
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { PermissionDeniedError } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  AVAILABLE_EVALUATORS,
  codeEvaluatorConfigSchema,
  EvaluatorApi,
  evaluatorConfig,
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
  type EvaluatorServerConfig,
  type EvaluatorResultAugmentationInput,
  type EvaluatorSyncFromSourceResult,
  type EvaluatorUpdateInput,
  type EvaluatorWithFields,
  type EvaluatorWorkflowFields,
  type NativeEvaluatorExecutionInput,
  type ResolvedEvaluatorExecution,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { preconditionMatchInputSchema } from "@langwatch/evaluator-contract/evaluation-types";
import { ValidationError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { ModelNotConfiguredError, ModelProviderApi } from "@langwatch/model-provider-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import type { Trace } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import {
  buildEvaluatorWorkflowArchiveCascadePipeline,
  type EvaluatorWorkflowArchiveCascadePipeline,
} from "../eventing/evaluator-workflow-archive-cascade.pipeline.ts";
import type { EvaluatorRepositories } from "../repositories/evaluator.repositories.ts";
import { evaluatorPlatformUrl } from "../rules/evaluator-platform-url.rules.ts";
import { findTraceIdsPassingPreconditions } from "../rules/precondition-trace-data.rules.ts";
import { EvaluatorCodeExecutionService } from "../services/evaluator-code-execution.service.ts";
import { EvaluatorCreationCapService } from "../services/evaluator-creation-cap.service.ts";
import {
  EvaluatorDeletionFactsService,
  type EvaluatorLifecycleSenders,
} from "../services/evaluator-deletion-facts.service.ts";
import { EvaluatorHistoryService } from "../services/evaluator-history.service.ts";
import { EvaluatorLinkedRowsService } from "../services/evaluator-linked-rows.service.ts";
import { EvaluatorReplicationService } from "../services/evaluator-replication.service.ts";
import { EvaluatorWorkflowArchiveService } from "../services/evaluator-workflow-archive.service.ts";
import { EvaluatorWorkflowPublicationService } from "../services/evaluator-workflow-publication.service.ts";
import { EvaluatorService as EvaluatorRuntimeService } from "../services/evaluator.service.ts";
import type { EvaluatorBrowserApi } from "../transport/evaluator.trpc.ts";

/** The workflow rows an evaluator is entangled with, read through their owner. */
export interface EvaluatorGraph {
  /** The evaluator's linked workflow, scoped to the project and not archived. */
  findLinkedWorkflow: (
    input: Readonly<{ workflowId: string; projectId: string }>,
  ) => Promise<{ id: string; name: string } | null>;
  /** Archives the evaluator's linked workflow. */
  archiveLinkedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<{ id: string }>;
  /** Clones a workflow evaluator's workflow into the target project. */
  replicateEvaluatorWorkflow: (
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actorId: string;
    }>,
  ) => Promise<string>;
  /** Removes a workflow a replication created, when the evaluator insert fails. */
  deleteReplicatedWorkflow: (
    input: Readonly<{ workflowId: string; projectId: string }>,
  ) => Promise<void>;
}

type EvaluatorSetup = FeatureSetup<
  typeof EvaluatorModule.dependencies,
  EvaluatorServerConfig,
  EvaluatorRepositories
>;

/** What the app is built from, once the setup has assembled it. */
type EvaluatorAppParts = Readonly<{
  evaluators: EvaluatorRuntimeService;
  modelProviders: ModelProviderApi;
  permissions: AuthzApi;
  graph: EvaluatorGraph;
  deletionFacts: EvaluatorDeletionFactsService;
  publications: EvaluatorWorkflowPublicationService;
  /** The cloud Free cap on custom evaluators. */
  creationCaps: EvaluatorCreationCapService;
  publicBaseUrl: string | undefined;
}>;

export class EvaluatorModule implements EvaluatorApi, EvaluatorBrowserApi {
  static readonly contract = EvaluatorApi;
  static readonly config = evaluatorConfig;
  static readonly dependencies = {
    /** Answers whether the caller may act in a project that is not the request's. */
    permissions: AuthzApi,
    /** The trail one evaluator's change history is read off. */
    auditLog: AuditLogApi,
    /** Names the person behind each row of that history. */
    users: UserApi,
    /** The workflow rows an evaluator's fields, its guard, its run and its replication read. */
    workflows: WorkflowApi,
    /** Resolves the project's default and embeddings models. */
    modelProviders: ModelProviderApi,
    /** The project's organization and its projects, which the evaluator cap counts across. */
    projects: ProjectApi,
    /** The plan whose cloud Free evaluator cap a create is checked against. */
    plans: EntitlementApi,
  };

  static create(setup: EvaluatorSetup): EvaluatorModule {
    const graph = EvaluatorLinkedRowsService.create({ workflows: setup.dependencies.workflows });

    return EvaluatorModule.createWithGraph(setup, graph);
  }

  /**
   * Split from {@link create} so a test can substitute a recording double for
   * the workflow graph without a real database — the graph interface
   * is this module's own seam, not a process member.
   */
  static createWithGraph(setup: EvaluatorSetup, graph: EvaluatorGraph): EvaluatorModule {
    const { dependencies, repositories, config } = setup;
    const evaluators = EvaluatorRuntimeService.create({
      repository: repositories.evaluators,
      workflows: dependencies.workflows,
      history: EvaluatorHistoryService.create({
        auditLog: dependencies.auditLog,
        users: dependencies.users,
      }),
      codeExecution: EvaluatorCodeExecutionService.withoutNlpRuntime(),
      generateId: (kind: string) => generate(kind).toString(),
    });

    const creationCaps = EvaluatorCreationCapService.create({
      plans: dependencies.plans,
      projects: dependencies.projects,
      evaluators: repositories.evaluators,
    });

    return new EvaluatorModule({
      evaluators,
      creationCaps,
      modelProviders: dependencies.modelProviders,
      permissions: dependencies.permissions,
      graph,
      deletionFacts: EvaluatorDeletionFactsService.create(),
      publications: EvaluatorWorkflowPublicationService.create({
        workflows: dependencies.workflows,
        evaluators,
        creationCaps,
      }),
      publicBaseUrl: config.publicBaseUrl,
    });
  }

  /** evaluator_lifecycle's senders, once the pipeline registers in this process. */
  connectLifecycle(senders: EvaluatorLifecycleSenders): void {
    this.#dependencies.deletionFacts.connect(senders);
  }

  /** Archives the evaluators a workflow backed once workflow records the archive (§9). */
  workflowArchiveCascadePipeline(): EvaluatorWorkflowArchiveCascadePipeline {
    return buildEvaluatorWorkflowArchiveCascadePipeline({
      evaluators: EvaluatorWorkflowArchiveService.create({
        evaluators: this.#dependencies.evaluators,
        deletionFacts: this.#dependencies.deletionFacts,
      }),
    });
  }

  #dependencies: EvaluatorAppParts;

  private constructor(dependencies: EvaluatorAppParts) {
    this.#dependencies = dependencies;
  }

  /** This module's own application, which the browser door reads through. */
  evaluators(): EvaluatorApi {
    return this;
  }

  /** Publishes a workflow as an evaluator, creating or renaming the evaluator that wraps it. */
  toggleSaveAsEvaluator(input: {
    workflowId: string;
    projectId: string;
    isEvaluator: boolean;
  }): Promise<void> {
    return this.#dependencies.publications.toggleSaveAsEvaluator(input);
  }

  /** Clears a workflow's evaluator flag and archives the evaluator that wrapped it. */
  disableAsEvaluator(input: { workflowId: string; projectId: string }): Promise<void> {
    return this.#dependencies.publications.disableAsEvaluator(input);
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
    const [evaluator] = await this.#dependencies.evaluators.findByIdWithFields(input);
    return evaluator;
  }

  /** One evaluator with its computed fields. */
  getByIdWithFields(input: { id: string; projectId: string }): Promise<EvaluatorWithFields> {
    return this.#dependencies.evaluators.getByIdWithFields(input);
  }

  /** One evaluator, or undefined. */
  async findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined> {
    const [evaluator] = await this.#dependencies.evaluators.findById(input);
    return evaluator;
  }

  /** One evaluator. */
  getById(input: { id: string; projectId: string }): Promise<Evaluator> {
    return this.#dependencies.evaluators.getById(input);
  }

  /** One evaluator by its project-unique slug, or undefined. */
  async findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined> {
    const [evaluator] = await this.#dependencies.evaluators.findBySlug(input);
    return evaluator;
  }

  /** One evaluator by its project-unique slug. */
  getBySlug(input: { slug: string; projectId: string }): Promise<Evaluator> {
    return this.#dependencies.evaluators.getBySlug(input);
  }

  /**
   * Addressed by id, falling back to slug. This two-step lookup is the
   * feature's rule, not the REST door's — reimplementing it there could
   * answer differently for a slug that looks like an id.
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
  listByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator[]> {
    return this.#dependencies.evaluators.findByWorkflow(input);
  }

  /** The entry-node fields a workflow evaluator maps trace data onto. */
  getWorkflowFields(input: { id: string; projectId: string }): Promise<EvaluatorWorkflowFields> {
    return this.#dependencies.evaluators.getWorkflowFields(input);
  }

  /** The workflow a cascade archive would take with the evaluator. */
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

    return { workflow };
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
   * Creates an evaluator within the plan's evaluator cap, refusing a code evaluator
   * with no program and a workflow that already answers for one.
   */
  async create(input: EvaluatorCreateInput): Promise<Evaluator> {
    await this.#dependencies.creationCaps.assertCreationAllowed({ projectId: input.projectId });
    return this.#createGuarded(input);
  }

  /** The create guards without the plan's cap, which a copy asks for itself. */
  async #createGuarded(input: EvaluatorCreateInput): Promise<Evaluator> {
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
    await this.#dependencies.creationCaps.assertCreationAllowed({ projectId: input.projectId });
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
  async createWithDefaults(input: EvaluatorCreateInput): Promise<Evaluator> {
    await this.#dependencies.creationCaps.assertCreationAllowed({ projectId: input.projectId });
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
   * Archives the evaluator and its linked workflow, then records `lw.evaluator.deleted`:
   * monitor removes the monitors that ran it from its own side, after a lag (R7).
   */
  async cascadeArchive(input: { id: string; projectId: string }): Promise<EvaluatorCascadeArchive> {
    const evaluator = await this.#dependencies.evaluators.getById(input);
    const archivedEvaluator = await this.#dependencies.evaluators.archive(input);
    const archivedWorkflow = evaluator.workflowId
      ? await this.#dependencies.graph.archiveLinkedWorkflow({
          workflowId: evaluator.workflowId,
          projectId: input.projectId,
        })
      : null;
    await this.#dependencies.deletionFacts.recordEvaluatorDeleted({
      projectId: input.projectId,
      evaluatorId: input.id,
    });

    return { evaluator: archivedEvaluator, archivedWorkflow };
  }

  /** Replicates the evaluator, and the workflow backing it, into another project. */
  async copy(input: {
    evaluatorId: string;
    projectId: string;
    sourceProjectId: string;
    newEvaluatorId: string;
    actorId: string;
    shouldCheckEvaluatorCap?: boolean;
  }): Promise<Evaluator> {
    const permitted = await this.#dependencies.permissions.hasPermission({
      userId: input.actorId,
      permission: "evaluations:manage",
      projectId: input.sourceProjectId,
    });

    if (!permitted) throw new EvaluatorSourcePermissionDeniedError(input.sourceProjectId);
    if (input.shouldCheckEvaluatorCap !== false) {
      await this.#dependencies.creationCaps.assertCreationAllowed({
        projectId: input.projectId,
        operatorId: input.actorId,
      });
    }

    return EvaluatorReplicationService.create({
      replicateEvaluatorWorkflow: (replication) =>
        this.#dependencies.graph.replicateEvaluatorWorkflow({
          ...replication,
          actorId: input.actorId,
        }),
      deleteReplicatedWorkflow: (replication) =>
        this.#dependencies.graph.deleteReplicatedWorkflow(replication),
    }).copyToProject({
      evaluators: {
        findById: (lookup) => this.findById(lookup),
        create: (copy) => this.#createGuarded(copy),
      },
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
   * Null only when the project has no default AND the evaluator type
   * declares none (#7556); when the type DOES declare one, absence stays a
   * failure rather than silently falling back to the catalog at RUN time.
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

  // ── the platform's own links ──────────────────────────────────────────────

  /**
   * The platform's own address for one evaluator resource. A deployment that
   * serves this family but named no public origin refuses by name.
   */
  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#dependencies.publicBaseUrl === undefined) {
      throw new Error(
        "The evaluators REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return evaluatorPlatformUrl({ publicBaseUrl: this.#dependencies.publicBaseUrl, ...input });
  }

  /** Main refused an unknown evaluator type or a malformed precondition as invalid input. */
  async findTraceIdsPassingPreconditions(input: {
    evaluatorType: string;
    preconditions: unknown;
    traces: readonly Trace[];
  }): Promise<string[]> {
    const parsed = preconditionMatchInputSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZodError(parsed.error);
    const { evaluatorType, preconditions } = parsed.data;
    const { traces } = input;

    return findTraceIdsPassingPreconditions({
      evaluatorType,
      preconditions,
      traces,
    });
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
  if (codeEvaluatorConfigSchema.validate(config)) return;

  throw new EvaluatorInvalidConfigError(evaluatorId);
}
