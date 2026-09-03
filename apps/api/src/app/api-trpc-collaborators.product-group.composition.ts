/**
 * The PRODUCT GROUP half of {@link ApiTrpcCollaborators}: the surfaces a member
 * reaches to run the product rather than to look at what it recorded.
 *
 *   authz.*                      what the caller may do at one scope
 *   batchRecord.*                the batch-evaluation rollups over a project
 *   dataset.* / datasetRecord.*  a project's datasets and the rows inside them
 *   evaluators.*                 the evaluators a project defines and copies
 *   featureFlag.*                which rollouts this tenant is inside
 *   home.*                       the recent-activity strip the home page renders
 *   personalWorkspaceFeatures.*  what a personal workspace may switch on
 *   prompts.* / promptTags.*     a project's prompt library and its tag catalogue
 *   role.* / roleBinding.*       custom role definitions and who holds them
 *   team.*                       a team, its members and their roles
 *
 * They are one composition because they are one graph in the only way that
 * matters at a composition root: every one of them is answered from this
 * process's OWN Prisma connection, its OWN AuthZ service and the tenancy graph
 * it already composed. None of them reaches ClickHouse, the model gateway, the
 * NLP engine or a mailer, which is what separates this half from the execution
 * and identity halves rather than any product taxonomy.
 *
 * ## This half OVERLAYS
 *
 * Unlike {@link composeApiProductCollaborators}, which seeds the collaborator
 * set, this one folds onto a base and passes an absent base through untouched.
 * The reason is the same one the analytics and execution halves have: it can
 * genuinely be missing. A process that composed no tenancy graph has no
 * organization or project directory to resolve a flag's tenant target through,
 * and a flag surface answering "not enabled" because it could not resolve the
 * organization would be a rollout silently switched off for everybody.
 *
 * ## The two named absences
 *
 * `team.assertCustomRolesAllowed` is the Enterprise plan gate on assigning a
 * custom role to a member. This process composes no billing store, so it
 * REFUSES by name rather than permitting: permitting would hand an Enterprise
 * capability to a deployment whose plan does not carry it, and the refusal is
 * the same `service_unavailable` shape every other absent Enterprise capability
 * in this graph answers with.
 *
 * `prompts.afterPromptCreated` is a lifecycle nurturing signal — a marketing
 * side effect on somebody's first prompt. It is fire-and-forget by
 * construction, so an absent product-analytics sink logs once instead of
 * refusing: refusing would cost a customer the prompt they just wrote, to
 * protect an email nobody was waiting on.
 */
import {
  bindingScopeCanGrantPermission,
  authzPermissionSchema,
  type AuthzGrantsService,
  type AuthzService,
} from "@langwatch/authz-contract";
import { AuthzApp, KsuidAuthzBindingIdAdapter } from "@langwatch/authz-server";
import type { DatasetService } from "@langwatch/dataset-contract";
import {
  DatasetApp,
  type BatchRecordTrpcPorts,
  type DatasetExperimentLookup,
  type DatasetTrpcPorts,
} from "@langwatch/dataset-server";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { EvaluatorApp, type EvaluatorTrpcPorts } from "@langwatch/evaluator-server";
import type { FeatureFlagConfig, FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  FeatureFlagCachePort,
  PostgresFeatureFlagAdapter,
  type FeatureFlagCacheSlot,
} from "@langwatch/feature-flag-server";
import { HandledError } from "@langwatch/handled-error";
import type { WorkflowApp } from "@langwatch/workflow-server";
import { TRPCError } from "@trpc/server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  assertNoPersonalTeamScope,
  type TeamTrpcPorts,
} from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import {
  PostgresRecentItemsAdapter,
  type HomeTrpcPorts,
  type RecentItem,
} from "@langwatch/project-server";
import { PostgresPromptAdapter, PromptApp, type PromptTrpcPorts } from "@langwatch/prompt-server";
import type { RoleBindingScopeType, RoleService } from "@langwatch/role-contract";
import {
  PostgresRoleAdapter,
  RoleApp,
  RolePermissionPort,
  RoleScopePort,
} from "@langwatch/role-server";
import type { RoleTrpcPorts } from "../features/role/role-trpc.mount";
import type { ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";

/**
 * A capability this deployment did not compose, refused by name.
 *
 * One class for every entry in this half rather than one per entry: the
 * customer-facing distinction is WHICH capability is missing, and that is the
 * `capability` the message carries. A subclass per absence would be six classes
 * for one code, and the code is what the presentation registry is keyed by.
 */
class ApiProductGroupUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiProductGroupUnavailableError";
  }
}

/**
 * The Enterprise plan gate on assigning a custom role, for a deployment that
 * composes one.
 *
 * A port rather than a `PlanProvider`, because what the team surface asks is
 * one question — may this organization's plan carry custom roles — and the
 * provider behind it takes a billing store, a Stripe client and a licence
 * reader that none of the other five surfaces here need.
 */
export abstract class ApiCustomRolePlanGatePort {
  /** Throws when the organization's plan may not assign a custom role. */
  abstract assertCustomRolesAllowed(input: {
    organizationId: string;
    members: readonly Readonly<{ role: string }>[];
  }): Promise<void>;
}

/**
 * The product signal a project's new prompt fires, for a deployment that has
 * one. Fire and forget: it may never fail a create.
 */
export abstract class ApiPromptNurturingPort {
  abstract afterPromptCreated(input: { projectId: string; userId?: string | null }): void;
}

export type ApiProductGroupCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
  /**
   * The organization directory the tenancy graph composed.
   *
   * Held rather than used to build an application: `team.*` reads
   * `ctx.app.organizations`, which the identity half owns. This is here so the
   * gate below is a decision about the graph rather than about one port — a
   * process with no organization directory can resolve no team at all.
   */
  organizations: OrganizationService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /**
   * The model gateway a stored prompt's model reference is resolved against.
   *
   * Optional: a prompt row reads and writes without it, and the adapter's own
   * contract treats an absent gateway as "no provider metadata" rather than a
   * failure. The `prompts` namespace therefore mounts on a deployment with no
   * gateway; what it cannot do there is annotate a version with the provider
   * behind its model.
   */
  modelProviders?: ModelProviderService;
  /** This deployment's flag configuration, as the flag service reads it. */
  featureFlags: FeatureFlagConfig;
  /**
   * The dataset service the execution half already composed.
   *
   * Taken rather than built, and that is the whole point: the workflow and
   * experiment applications read a project's rows through this same service,
   * and a second one here would let `dataset.getAll` and an experiment's own
   * row read disagree about what a dataset contains.
   */
  datasets: DatasetService;
  /** The experiment lookup a dataset resolves a borrowed name through. */
  experimentLookup: DatasetExperimentLookup;
  /**
   * The evaluator service the execution half already composed. Taken rather
   * than built, for the same reason the dataset service is: the workflow
   * application publishes evaluators through this one.
   */
  evaluators: EvaluatorService;
  /**
   * The workflow application a WORKFLOW evaluator's graph is replicated
   * through. The studio DSL, its dataset references and its version history
   * are Workflow's, and neither the evaluator nor the monitor package reaches
   * into them.
   */
  workflows: WorkflowApp;
  /**
   * The grant ledger custom-role bindings are written through.
   *
   * The SAME ledger the AuthZ service reads decisions from: a binding written
   * to one and read from another is a role that appears to have been granted
   * and grants nothing.
   */
  grants: AuthzGrantsService;
  /** The Enterprise plan gate, where the deployment composed one. */
  customRolePlan?: ApiCustomRolePlanGatePort;
  /** The nurturing sink, where the deployment composed one. */
  promptNurturing?: ApiPromptNurturingPort;
}>;

/** The application slices and the port groups this half owns, composed together. */
export type ApiProductGroupCollaborators = Readonly<{
  /** For `ctx.app.authzApp`. */
  authzApp: AuthzApp;
  /** For `ctx.app.dataset`. */
  datasetApp: DatasetApp;
  /** For `ctx.app.evaluatorApp`. */
  evaluatorApp: EvaluatorApp;
  /** For `ctx.app.featureFlags`. */
  featureFlagService: FeatureFlagService;
  /** For `ctx.app.permissions`. */
  permissions: Pick<AuthzService, "hasPermission">;
  /** For `ctx.app.projects`. */
  projectReads: Readonly<{ getOrganizationId(projectId: string): Promise<string> }>;
  /** For `ctx.app.prompts`. */
  promptApp: PromptApp;
  /** For `ctx.app.roles` — the same application both role surfaces read. */
  roleApp: RoleApp;
  /**
   * The role service under {@link ApiProductGroupCollaborators.roleApp}.
   *
   * Exposed beside the application rather than composed a second time, because
   * one other surface asks it a question no application method carries: the
   * invitation half asks which custom roles an organization MAY ASSIGN, and an
   * invitation validated against a second copy of that rule would be accepted
   * on write and silently dropped on acceptance.
   */
  roles: RoleService;
  /** The `batchRecord` entry of {@link ApiTrpcCollaborators}. */
  batchRecordPorts: BatchRecordTrpcPorts<unknown, unknown>;
  /** The `dataset` entry. */
  datasetPorts: DatasetTrpcPorts;
  /** The `evaluators` entry. */
  evaluatorPorts: EvaluatorTrpcPorts;
  /** The `home` entry. */
  homePorts: HomeTrpcPorts;
  /** The `prompts` entry. */
  promptPorts: PromptTrpcPorts;
  /** The `role` entry. */
  rolePorts: RoleTrpcPorts;
  /** The `team` entry. */
  teamPorts: TeamTrpcPorts;
}>;

/**
 * The flag cache, absent.
 *
 * Every read goes to Postgres. That is the correct default for a process with
 * no shared cache rather than a degradation: a cached flag on one process and
 * an uncached one on another is a rollout that answers two different ways at
 * the same instant, which is worse than answering slowly.
 */
class UncachedApiFeatureFlags extends FeatureFlagCachePort {
  tryGet(_key: string): Promise<FeatureFlagCacheSlot | undefined> {
    return Promise.resolve(undefined);
  }

  set(_key: string, _slot: FeatureFlagCacheSlot): Promise<void> {
    return Promise.resolve();
  }

  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
}

/** Composes the product-group half from this process's own graph. */
export function composeApiProductGroupCollaborators(
  options: ApiProductGroupCollaboratorsOptions,
): ApiProductGroupCollaborators {
  const logger = createLogger("langwatch:api:product-group");

  const authzApp = AuthzApp.create({ permissions: options.authz });

  const featureFlagService = PostgresFeatureFlagAdapter.create({
    database: options.prisma,
    cache: new UncachedApiFeatureFlags(),
    config: options.featureFlags,
    now: () => Date.now(),
  });

  const promptApp = PromptApp.create({
    prompts: PostgresPromptAdapter.create({
      database: options.prisma,
      ...(options.modelProviders ? { modelProvider: options.modelProviders } : {}),
    }).build(),
    projects: options.projects,
  });

  const recentItems = PostgresRecentItemsAdapter.create({ database: options.prisma }).build();

  const bindingIds = KsuidAuthzBindingIdAdapter.create();
  const roles = PostgresRoleAdapter.create({
    database: options.prisma,
    grants: options.grants,
    permissions: options.authz,
    newBindingId: () => bindingIds.newBindingId(),
    scope: new ApiRoleScope(options.prisma),
    permission: new ApiRolePermissions(),
  }).build();
  const roleApp = RoleApp.create({
    roles,
    permissions: options.authz,
    authzGrants: options.grants,
  });

  const datasetApp = DatasetApp.create({
    dataset: options.datasets,
    experiments: options.experimentLookup,
  });

  const evaluatorApp = EvaluatorApp.create({
    evaluators: options.evaluators,
    // The gateway resolves a project's default and embeddings models when an
    // evaluator is created without naming them. With none composed the
    // evaluator package's own rule applies — the caller must name the model —
    // which is a narrower surface rather than a wrong answer.
    ...(options.modelProviders ? { modelProviders: options.modelProviders } : {}),
  } as Parameters<typeof EvaluatorApp.create>[0]);

  return {
    authzApp,
    datasetApp,
    evaluatorApp,
    featureFlagService,
    permissions: options.authz,
    projectReads: options.projects,
    promptApp,
    roleApp,
    roles,
    /**
     * The two batch-evaluation rollups, read off this process's own connection.
     *
     * They are the HOST's rather than the dataset package's because the table
     * is: `BatchEvaluation` records what an experiment run scored, and the
     * dataset it ran against is a join rather than the subject.
     */
    batchRecordPorts: {
      summariseByExperiment: (_ctx, { projectId }) =>
        options.prisma.batchEvaluation.groupBy({
          by: ["experimentId", "datasetSlug"],
          where: { projectId },
          _count: { experimentId: true },
          _sum: { cost: true },
          _avg: { score: true },
        }),
      listByExperiment: (_ctx, { projectId, experimentId }) =>
        options.prisma.batchEvaluation.findMany({
          where: { projectId, experimentId },
          include: { dataset: true },
        }),
    },
    datasetPorts: {
      /**
       * A copy reads a SECOND project — the source — that the declared check on
       * the procedure never covered, so the source is probed separately before
       * anything is read from it. Answered by the one AuthZ service this
       * process authorizes with.
       */
      probeProjectPermission: (ctx, projectId, permission) =>
        options.authz.hasPermission({
          userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
          permission,
          projectId,
        }),
    },
    evaluatorPorts: composeEvaluatorPorts(options),
    homePorts: {
      /**
       * The strip walks this process's own audit trail and then hydrates each
       * entity it finds there, so it is answered from the connection rather
       * than from any one feature's service — five verticals' rows behind one
       * read is nobody's service but the application's.
       */
      getRecentItems: (
        _ctx,
        input: Readonly<{ userId: string; projectId: string; limit: number }>,
      ): Promise<RecentItem[]> => recentItems.getRecentItems(input),
    },
    promptPorts: {
      afterPromptCreated: (input) => {
        const nurturing = options.promptNurturing;
        if (!nurturing) {
          logger.debug(
            { projectId: input.projectId },
            "no prompt nurturing sink is composed: the lifecycle signal for this prompt is not sent",
          );
          return;
        }
        nurturing.afterPromptCreated(input);
      },
    },
    rolePorts: {
      probeOrganizationPermission: (ctx, organizationId, permission) =>
        options.authz.hasPermission({
          userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
          permission,
          organizationId,
        }),
      assertCustomRolePlan: async (_ctx, input) => {
        const gate = options.customRolePlan;
        if (!gate) {
          logger.warn(
            { organizationId: input.organizationId },
            "no Enterprise plan gate is composed: refusing a custom role definition or assignment",
          );
          throw new ApiProductGroupUnavailableError("Custom roles");
        }
        await gate.assertCustomRolesAllowed({ organizationId: input.organizationId, members: [] });
      },
      /**
       * The permission vocabulary a custom role's entries are parsed against.
       *
       * The AuthZ REGISTRY's enumeration rather than the cross product of every
       * resource and every action: the registry is what the engine actually
       * evaluates, so a role naming a pair outside it would store a grant that
       * can never match.
       */
      customRolePermission: authzPermissionSchema,
    },
    teamPorts: composeTeamPorts(options, logger),
  };
}

/**
 * The two answers the team surface needs from the deployment.
 *
 * `probeOrganizationPermission` is not a gate — the two member reads pass it to
 * the service, which widens or narrows what each row shows — so it is answered
 * by the same AuthZ service the declared check on the procedure already ran on.
 * A second permission service here would be a second answer to one question.
 */
function composeTeamPorts(
  options: ApiProductGroupCollaboratorsOptions,
  logger: Pick<Logger, "warn">,
): TeamTrpcPorts {
  return {
    probeOrganizationPermission: (ctx, organizationId, permission) =>
      options.authz.hasPermission({
        userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
        permission,
        organizationId,
      }),
    assertCustomRolesAllowed: async (_ctx, input) => {
      const gate = options.customRolePlan;
      if (!gate) {
        // Only a list that actually assigns a custom role is refused. A member
        // list carrying none never touches the Enterprise capability, and
        // refusing it would break team editing on every deployment that
        // composes no billing store.
        if (!input.members.some((member) => isCustomRole(member.role))) return;
        logger.warn(
          { organizationId: input.organizationId },
          "no Enterprise plan gate is composed: refusing a member list that assigns a custom role",
        );
        throw new ApiProductGroupUnavailableError("Custom role assignment");
      }
      await gate.assertCustomRolesAllowed({
        organizationId: input.organizationId,
        members: input.members,
      });
    },
  };
}

/**
 * Whether a member's role names a CUSTOM role rather than one of the built-in
 * team roles.
 *
 * A naming convention rather than an entitlement, which is why it travels with
 * the composition instead of with the plan gate: the built-in roles are a
 * closed set, so anything outside it is a role the organization defined.
 */
const BUILT_IN_TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER"]);

function isCustomRole(role: string): boolean {
  return !BUILT_IN_TEAM_ROLES.has(role);
}


/**
 * The personal-workspace fence a role binding is refused at, over this
 * process's own connection.
 *
 * The rule itself is the organization package's — a personal workspace has
 * exactly one admin, its owner, so a binding that reaches it is a grant into
 * somebody's private space — and this only supplies the client it reads teams
 * through.
 */
class ApiRoleScope extends RoleScopePort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async assertNoPersonalTeamScope(input: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<void> {
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: input.scopes });
  }
}

/**
 * ADR-021's scope fence, read off the AuthZ registry rather than a hand-kept
 * set.
 *
 * The registry records which tiers each resource is grantable at, so it cannot
 * fall behind a resource somebody added; the set it replaces could and did.
 * A permission the registry does not know is treated as non-exclusive, which is
 * what the legacy fence did with anything outside its own list.
 */
class ApiRolePermissions extends RolePermissionPort {
  isOrganizationExclusive(permission: string): boolean {
    return !bindingScopeCanGrantPermission({ scopeType: "TEAM", permission });
  }

  organizationExclusiveScopeError(input: {
    permission: string;
    scopeType: RoleBindingScopeType;
  }): Error {
    return new OrgExclusivePermissionScopeError(input.permission, input.scopeType);
  }
}

/**
 * An organization-exclusive permission was bound at TEAM or PROJECT scope.
 *
 * Refused at write time rather than accepted and ignored: the resolver never
 * grants these below organization scope, so storing the binding would leave an
 * administrator believing a grant took effect that does nothing.
 */
class OrgExclusivePermissionScopeError extends HandledError {
  declare readonly code: "org_exclusive_permission_scope";

  constructor(permission: string, scopeType: string) {
    super(
      "org_exclusive_permission_scope",
      "That permission only takes effect at organization scope",
      { httpStatus: 422, meta: { permission, scopeType } },
    );
    this.name = "OrgExclusivePermissionScopeError";
  }
}

/**
 * Everything an evaluator reaches that the evaluator package does not own.
 *
 * Four of the six are row reads on the process's own connection — the linked
 * workflow, the monitors running this evaluator, their deletion, and archiving
 * the graph. The other two REPLICATE that graph into another project, which is
 * the workflow application's copy: its dataset copier, its DSL rewrite, its
 * version parentage. None of it belongs to an evaluator.
 */
function composeEvaluatorPorts(
  options: ApiProductGroupCollaboratorsOptions,
): EvaluatorTrpcPorts {
  const { prisma, workflows } = options;

  const deleteReplicatedWorkflow = async (
    _ctx: unknown,
    { workflowId, projectId }: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void> => {
    // `deleteMany` rather than `delete` so the multitenancy guard accepts the
    // project scope: a bare `{ id }` delete is rejected and the rollback below
    // silently no-ops.
    await prisma.workflow.deleteMany({ where: { id: workflowId, projectId } });
  };

  return {
    findLinkedWorkflow: (_ctx, { workflowId, projectId }) =>
      prisma.workflow.findFirst({
        where: { id: workflowId, projectId, archivedAt: null },
        select: { id: true, name: true },
      }),
    findMonitorsUsingEvaluator: (_ctx, { evaluatorId, projectId }) =>
      prisma.monitor.findMany({
        where: { evaluatorId, projectId },
        select: { id: true, name: true },
      }),
    deleteMonitorsUsingEvaluator: (_ctx, { evaluatorId, projectId }) =>
      prisma.monitor.deleteMany({ where: { evaluatorId, projectId } }),
    archiveLinkedWorkflow: (_ctx, { workflowId, projectId }) =>
      prisma.workflow.update({
        where: { id: workflowId, projectId },
        data: { archivedAt: new Date() },
      }),
    replicateEvaluatorWorkflow: async (ctx, { workflowId, sourceProjectId, targetProjectId }) => {
      const workflow = await prisma.workflow.findFirst({
        where: { id: workflowId, projectId: sourceProjectId, archivedAt: null },
        include: { latestVersion: true },
      });

      // Refused rather than copied: an evaluator created against a graph with
      // no saved version is a structurally broken replica, and the break only
      // shows up when somebody runs it.
      if (!workflow?.latestVersion?.dsl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot replicate a workflow evaluator without a saved workflow version",
        });
      }

      const { workflowId: newWorkflowId, dsl } = await workflows.copyStudioWorkflow({
        workflow: {
          id: workflow.id,
          name: workflow.name,
          icon: workflow.icon,
          description: workflow.description,
          isEvaluator: workflow.isEvaluator,
          isComponent: workflow.isComponent,
          latestVersion: workflow.latestVersion,
        },
        targetProjectId,
        sourceProjectId,
        copiedFromWorkflowId: workflowId,
      } as Parameters<WorkflowApp["copyStudioWorkflow"]>[0]);

      try {
        await workflows.saveStudioVersion(
          {
            projectId: targetProjectId,
            workflowId: newWorkflowId,
            dsl,
            autoSaved: false,
            commitMessage: "Copied from " + workflow.name,
          },
          { id: (ctx as unknown as ApiTrpcPortsContext).actor().id },
        );
      } catch (saveError) {
        await deleteReplicatedWorkflow(ctx, {
          workflowId: newWorkflowId,
          projectId: targetProjectId,
        }).catch(() => undefined);
        throw saveError;
      }

      return newWorkflowId;
    },
    deleteReplicatedWorkflow,
  };
}
