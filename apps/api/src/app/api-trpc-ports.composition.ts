/**
 * The API process's answer to `AppTrpcFeaturePorts` — the capabilities the
 * twenty-two packaged tRPC namespaces reach that their own feature packages do
 * not own.
 *
 * This is where the platform application's ports object moved to. Two things
 * changed on the way, and only two:
 *
 *  1. The entries that were ROW READS now run on this process's own guarded
 *     Prisma connection instead of the one hanging off a request context.
 *     There were about forty of them — the workflow copy lineage, the user
 *     rows behind the /me screens, the studio's published components — and
 *     every one of them already had its project or user id in hand. They never
 *     needed a service locator, only a connection.
 *
 *     Four of them have since left again, and the reason names the limit of
 *     rule 1: they read `Account`, where the stored password hash lives, and
 *     "a row read with an id already in hand" is not a licence to select a
 *     credential column. They are the user feature's own reads now.
 *  2. The entries that reach a SERVICE this process does not compose arrive as
 *     {@link ApiTrpcCollaborators}, named one by one, and their absence is a
 *     refusal to compose the record rather than a record whose procedures fail
 *     at first call.
 *
 * What did NOT change is the shape of a single port. Every signature here is
 * the one the feature package declared, because the client's types are derived
 * from them — the studio reads a stored version with the shape the row has,
 * and a port that answered `unknown` would hand the pages `unknown`.
 */
import type { AnalyticsReadInput, AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { PostgresAnnotationQueueAdapter } from "@langwatch/annotation-server";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { pMapLimited } from "@langwatch/eventing";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import type { ZodTypeAny } from "zod";
import type { ApiAuditPort } from "../api-request.policy";
import type { ApiTrpcFeatureMount } from "../api.application";
import type { ApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";

/** Where one copy lives, for the "org / team / project" path shown beside it. */
const workflowCopyPathSelect = {
  id: true,
  name: true,
  projectId: true,
  project: {
    select: {
      id: true,
      name: true,
      team: {
        select: {
          id: true,
          name: true,
          organization: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

/** The copy-lineage selection `workflow.getAll` redacts against permissions. */
const workflowCopyLineageSelect = {
  id: true,
  projectId: true,
  name: true,
  icon: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  latestVersionId: true,
  currentVersionId: true,
  publishedId: true,
  publishedById: true,
  archivedAt: true,
  isEvaluator: true,
  isComponent: true,
  copiedFromWorkflowId: true,
  copiedFrom: { select: workflowCopyPathSelect },
  copiedWorkflows: { where: { archivedAt: null }, select: { projectId: true } },
} as const;

/** The process's own collaborators, beside the ones it receives. */
export type ApiTrpcPortsCompositionOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /**
   * The AuthZ service the REST doors already authorize through, so a
   * permission probe inside a resolver answers what the declared check on the
   * same procedure would have.
   */
  authz: AuthzService;
  /**
   * The audit trail. Absent on a process that composed no sink: the two
   * entries that write to it then record nothing, which is the same
   * degradation every other door on this process already has.
   */
  audit: ApiAuditPort | undefined;
  /** The one place a declaration is turned into the middleware that runs it. */
  mount: ApiTrpcFeatureMount;
}>;

/**
 * Builds the full ports object from this process's graph plus the collaborators
 * it received.
 *
 * Generic over the same parameters `createAppTrpcFeatures` is, and for the same
 * reason: those types are what the client sees. `TWorkflowVersion` and
 * `TPublishedComponent` are the exception — they are inferred from the row
 * reads written here rather than supplied, because the studio reads exactly
 * what this connection returns.
 */
export function createApiTrpcPorts<
  TBugReport,
  TBugReportPage,
  TCheckStatus,
  TFilterField extends string,
  TMappingsIn,
  TMappingsOut,
  TPrivacyRule,
  TPrivacySnapshot,
  TReadInput extends AnalyticsReadInput,
  TSignUpDataSchema extends ZodTypeAny,
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TWorkbenchState,
  TTimeseriesInputWire,
  TReadInputWire,
>(
  options: ApiTrpcPortsCompositionOptions & {
    collaborators: ApiTrpcCollaborators<
      TBugReport,
      TBugReportPage,
      TCheckStatus,
      TFilterField,
      TMappingsIn,
      TMappingsOut,
      TPrivacyRule,
      TPrivacySnapshot,
      TReadInput,
      TSignUpDataSchema,
      TTimeseriesInput,
      TWorkbenchState,
      TTimeseriesInputWire,
      TReadInputWire
    >;
  },
) {
  const { prisma, authz, audit, mount, collaborators } = options;

  /** The caller of one request, as the row reads and probes below read it. */
  const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

  /**
   * The same question the declared check on the procedure asked, asked again
   * inside a resolver for a project the INPUT did not name — a copy's target,
   * a related workflow's own project. Answered by the one AuthZ service this
   * process authorizes with, never a second.
   */
  const probeProjectPermission = (
    ctx: unknown,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean> => authz.hasPermission({ userId: actorId(ctx), permission, projectId });

  return {
    analytics: collaborators.analytics,

    annotation: {
      // Queue rows are Postgres, and the packaged adapter is what reads them.
      queues: () => PostgresAnnotationQueueAdapter.create({ database: prisma }).build(),

      // A suggested output rewrites the trace itself, so it is carried over
      // only for a caller who may also update annotations. The declared check
      // on the procedure covers the annotation; this covers the correction.
      probeProjectPermission,

      toQueueSlug: annotationQueueSlug,

      ...collaborators.annotation,
    },

    /**
     * Fire and forget, exactly as the API-key router has always recorded it: a
     * credential response never waits on the audit write. The minted token is
     * never among the arguments the package passes here.
     */
    apiKeyAudit: (entry: {
      userId: string;
      organizationId: string;
      action: string;
      args: Readonly<Record<string, unknown>>;
    }) => {
      void audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: { organizationId: entry.organizationId, args: entry.args },
        error: null,
      });
    },

    /**
     * The support inbox, and the audit trail every read of it is written to.
     *
     * Unlike the API-key sink above this one is AWAITED: the row is the record
     * of who opened somebody's transcript, and it is written before they see
     * it.
     */
    bugReports: {
      ...collaborators.bugReports,
      recordAudit: async (entry: {
        userId: string;
        action: string;
        args?: Readonly<Record<string, unknown>>;
        targetKind: string;
        targetId?: string;
      }) => {
        await audit?.record({
          actorId: entry.userId,
          path: entry.action,
          input: {
            ...(entry.args ?? {}),
            targetKind: entry.targetKind,
            ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
          },
          error: null,
        });
      },
    },

    auth: collaborators.auth,

    dataPrivacy: collaborators.dataPrivacy,

    /**
     * What each rule write claims about the project id it accepts, written
     * where the enforcement is.
     *
     * Neither is a permission the runtime can resolve from the input: the id
     * that decides the answer is the TARGET scope's, and which tier that is
     * only becomes known once the scope has been anchored to this project's
     * organization. So the check is declared as resolver-authorized and the
     * sentence names what the port above actually runs.
     */
    dataPrivacyScopeChecks: {
      write: mount.middlewares.declaredCheck({
        kind: "service-authorized",
        reason:
          "the data-privacy port anchors the scope to this project's organization and then authorizes the write at the target scope's own tier",
        permissions: ["project:update"],
        enforces: {
          projectId:
            "assertScopeBelongsToProjectOrganization anchors the scope to this project's organization; assertCanWriteDataPrivacyScope authorizes the write",
        },
      }),
      removal: mount.middlewares.declaredCheck({
        kind: "service-authorized",
        reason:
          "the data-privacy port anchors the scope to this project's organization and then authorizes the removal at the target scope's own tier",
        permissions: ["project:update"],
        enforces: {
          projectId:
            "assertScopeBelongsToProjectOrganization anchors the scope to this project's organization; assertCanWriteDataPrivacyScope authorizes the removal",
        },
      }),
    },

    evaluations: collaborators.evaluations,

    experiments: {
      ...collaborators.experiments,

      probeProjectPermission: (ctx: unknown, projectId: string, permission: AuthzPermission) =>
        probeProjectPermission(ctx, projectId, permission),

      createWorkflow: async (
        _ctx: unknown,
        input: Readonly<{
          projectId: string;
          name: string;
          icon?: string | null;
          description?: string | null;
        }>,
      ) =>
        await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: input.projectId,
            name: input.name,
            icon: input.icon ?? "",
            description: input.description ?? "",
          },
        }),

      tryFindWorkflow: async (
        _ctx: unknown,
        input: Readonly<{ workflowId: string; projectId: string }>,
      ) =>
        await prisma.workflow.findFirst({
          where: { id: input.workflowId, projectId: input.projectId },
        }),

      resolveAuthorNames: async (_ctx: unknown, authorIds: readonly string[]) =>
        await prisma.user.findMany({
          where: { id: { in: [...authorIds] } },
          select: { id: true, name: true },
        }),
    },

    batchRecord: collaborators.batchRecord,

    dataset: collaborators.dataset,

    evaluators: collaborators.evaluators,

    graphs: collaborators.graphs,

    group: collaborators.group,

    home: collaborators.home,

    identity: collaborators.identity,

    integrationsChecks: collaborators.integrationsChecks,

    joinRequests: {
      ...collaborators.joinRequests,
      listUserNames: (_ctx: unknown, { userIds }: Readonly<{ userIds: readonly string[] }>) =>
        prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true },
        }),
    },

    onboarding: collaborators.onboarding,

    /**
     * The process's database client. One surface takes it directly: the
     * evaluation mount builds its custom-evaluator read on the client rather
     * than on a request context, because that read is the same table scan for
     * every caller.
     */
    prisma,

    prompts: collaborators.prompts,

    role: collaborators.role,

    team: collaborators.team,

    /**
     * The sixteen observability surfaces, forwarded whole.
     *
     * Nothing is lifted out of this group onto the process's own connection the
     * way the workflow and user row reads were: the group is COMPOSED against
     * that connection already, by `composeApiTraceGroupCollaborators`, which is
     * also where each capability it cannot build names its own absence.
     */
    traceGroup: collaborators.traceGroup,

    dataRetention: collaborators.dataRetention,
    monitors: collaborators.monitors,

    /**
     * The nine tenant-administration surfaces, forwarded whole, for the same
     * reason the sixteen above are: the group is COMPOSED against this
     * process's connection already, by `composeApiOrgGroupCollaborators`,
     * which is also where each capability it cannot build names its own
     * absence.
     */
    orgGroup: collaborators.orgGroup,

    /**
     * The six agent surfaces, forwarded whole, for the same reason: the group
     * is COMPOSED against this process's Prisma, ClickHouse and Redis already,
     * by `composeApiAgentGroupCollaborators`, which is also where each
     * capability it cannot build names its own absence.
     */
    agentGroup: collaborators.agentGroup,

    gateway: collaborators.gateway,
    governanceHome: collaborators.governanceHome,
    saasBilling: collaborators.saasBilling,

    /** The two answers `github.*` reaches, forwarded whole for the same reason. */
    github: collaborators.github,

    /**
     * The user rows this connection answers, and the four it deliberately
     * does not.
     *
     * `Account` — the table a person's sign-in methods live on, and the table
     * the bcrypt password hash lives ON — is not read here at all any more.
     * Four entries used to be, one of them a `select` naming `password`. They
     * arrive through `collaborators.user` now, answered by the user feature's
     * own `UserCredentialService`, which compares a hash and discards it
     * rather than handing it out. `specs` state the invariant; the composition
     * test hands this function a client whose `account` delegate refuses every
     * access, and the four answers still come back.
     *
     * What is left is `User`, a different table with no credential on it.
     */
    user: {
      ...collaborators.user,

      emailIsTaken: async (_ctx: unknown, { email }: Readonly<{ email: string }>) =>
        (await prisma.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        })) !== null,

      isOrganizationMember: async (
        _ctx: unknown,
        { userId, organizationId }: Readonly<{ userId: string; organizationId: string }>,
      ) =>
        (await prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId, organizationId } },
        })) !== null,

      tryGetOrganizationName: async (
        _ctx: unknown,
        { organizationId }: Readonly<{ organizationId: string }>,
      ) =>
        (
          await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true },
          })
        )?.name ?? null,

      tryGetUserContact: (_ctx: unknown, { userId }: Readonly<{ userId: string }>) =>
        prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        }),

      tryFindFirstProjectSlug: async (
        _ctx: unknown,
        { organizationId, userId }: Readonly<{ organizationId: string; userId: string }>,
      ) =>
        (
          await prisma.project.findFirst({
            where: {
              team: { organizationId, members: { some: { userId } } },
              archivedAt: null,
            },
            orderBy: { createdAt: "asc" },
            select: { slug: true },
          })
        )?.slug ?? null,
    },

    workflows: {
      lifecycle: {
        ...collaborators.workflows.lifecycle,

        hasProjectPermission: (
          ctx: unknown,
          input: Readonly<{ projectId: string; permission: AuthzPermission }>,
        ) => probeProjectPermission(ctx, input.projectId, input.permission),

        // Each related project needs its own check; cap concurrency so a
        // workflow with many copies cannot exhaust the connection pool.
        hasProjectPermissions: async (
          ctx: unknown,
          input: Readonly<{ projectIds: readonly string[]; permission: AuthzPermission }>,
        ) => {
          const permitted = new Map<string, boolean>();
          await pMapLimited({
            items: [...input.projectIds],
            concurrency: 5,
            fn: async (projectId: string) => {
              permitted.set(
                projectId,
                await probeProjectPermission(ctx, projectId, input.permission),
              );
            },
          });
          return permitted;
        },

        listWorkflowsWithCopyLineage: async (
          _ctx: unknown,
          input: Readonly<{ projectId: string }>,
        ) =>
          await prisma.workflow.findMany({
            where: { projectId: input.projectId, archivedAt: null },
            orderBy: { updatedAt: "desc" },
            select: workflowCopyLineageSelect,
          }),

        // Prisma requires projectId in the where clause for a project-level model.
        tryFindWorkflow: async (
          _ctx: unknown,
          input: Readonly<{ workflowId: string; projectId: string }>,
        ) =>
          await prisma.workflow.findFirst({
            where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
          }),

        // Copies are queried through the relation so the findMany's projectId
        // requirement does not force a single project on a cross-project read.
        tryFindCopiesWithPath: async (
          _ctx: unknown,
          input: Readonly<{ workflowId: string; projectId: string }>,
        ) => {
          const workflowWithCopies = await prisma.workflow.findUnique({
            where: { id: input.workflowId, projectId: input.projectId },
            select: {
              id: true,
              copiedWorkflows: { where: { archivedAt: null }, select: workflowCopyPathSelect },
            },
          });

          return workflowWithCopies ? workflowWithCopies.copiedWorkflows : null;
        },

        tryFindWorkflowWithSource: async (
          _ctx: unknown,
          input: Readonly<{ workflowId: string; projectId: string }>,
        ) =>
          await prisma.workflow.findUnique({
            where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
            include: { latestVersion: true, copiedFrom: { include: { latestVersion: true } } },
          }),

        tryFindWorkflowWithCopies: async (
          _ctx: unknown,
          input: Readonly<{ workflowId: string; projectId: string }>,
        ) =>
          await prisma.workflow.findUnique({
            where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
            include: {
              latestVersion: true,
              copiedWorkflows: {
                where: { archivedAt: null },
                include: { latestVersion: true },
              },
            },
          }),

        tryFindLatestVersionNumber: async (
          _ctx: unknown,
          input: Readonly<{ workflowId: string; projectId: string }>,
        ) => {
          const workflow = await prisma.workflow.findUnique({
            where: { id: input.workflowId, projectId: input.projectId },
            include: { latestVersion: true },
          });

          return workflow ? { version: workflow.latestVersion?.version ?? null } : null;
        },

        listAgentsForWorkflow: async (
          _ctx: unknown,
          input: Readonly<{ workflowId: string; projectId: string }>,
        ) =>
          await prisma.agent.findMany({
            where: {
              workflowId: input.workflowId,
              projectId: input.projectId,
              archivedAt: null,
            },
            select: { id: true, name: true },
          }),

        listMonitorsForEvaluators: async (
          _ctx: unknown,
          input: Readonly<{ projectId: string; evaluatorIds: readonly string[] }>,
        ) =>
          (
            await prisma.monitor.findMany({
              where: {
                evaluatorId: { in: [...input.evaluatorIds] },
                projectId: input.projectId,
              },
              select: { id: true, name: true, evaluatorId: true },
            })
          ).flatMap(({ id, name, evaluatorId }) =>
            evaluatorId === null ? [] : [{ id, name, evaluatorId }],
          ),

        cascadeArchiveWorkflow: async (
          _ctx: unknown,
          input: Readonly<{ projectId: string; workflowId: string; unarchive?: boolean }>,
        ) => {
          const now = input.unarchive ? null : new Date();

          return prisma.$transaction(async (tx) => {
            // 1. Find all evaluators linked to this workflow
            const evaluators = await tx.evaluator.findMany({
              where: {
                workflowId: input.workflowId,
                projectId: input.projectId,
                archivedAt: null,
              },
              select: { id: true },
            });
            const evaluatorIds = evaluators.map((evaluator) => evaluator.id);

            // 2. Delete monitors linked to those evaluators (hard delete)
            const deletedMonitors =
              evaluatorIds.length > 0
                ? await tx.monitor.deleteMany({
                    where: { evaluatorId: { in: evaluatorIds }, projectId: input.projectId },
                  })
                : { count: 0 };

            // 3. Archive evaluators linked to this workflow
            const archivedEvaluators = await tx.evaluator.updateMany({
              where: { workflowId: input.workflowId, projectId: input.projectId },
              data: { archivedAt: now },
            });

            // 4. Archive agents linked to this workflow
            const archivedAgents = await tx.agent.updateMany({
              where: { workflowId: input.workflowId, projectId: input.projectId },
              data: { archivedAt: now },
            });

            // 5. Archive the workflow itself
            const workflow = await tx.workflow.update({
              where: { id: input.workflowId, projectId: input.projectId },
              data: { archivedAt: now },
            });

            return {
              workflow,
              archivedEvaluatorsCount: archivedEvaluators.count,
              archivedAgentsCount: archivedAgents.count,
              deletedMonitorsCount: deletedMonitors.count,
            };
          });
        },
      },

      // Written out rather than inferred: the studio reads a stored version and
      // a published component with the shape the rows have, and the transport
      // is generic over both so the client sees exactly that.
      optimization: {
        ...collaborators.workflows.optimization,

        tryGetWorkflow: async (
          _ctx: unknown,
          input: Readonly<{ workflowId: string; projectId: string }>,
        ) =>
          await prisma.workflow.findFirst({
            where: { id: input.workflowId, projectId: input.projectId },
          }),

        tryGetWorkflowVersion: async (
          _ctx: unknown,
          input: Readonly<{ versionId: string; projectId: string }>,
        ) =>
          await prisma.workflowVersion.findFirst({
            where: { id: input.versionId, projectId: input.projectId },
          }),

        setWorkflowFlags: async (
          _ctx: unknown,
          input: Readonly<{
            workflowId: string;
            projectId: string;
            isComponent?: boolean;
            isEvaluator?: boolean;
          }>,
        ) => {
          await prisma.workflow.update({
            where: { id: input.workflowId, projectId: input.projectId },
            data: {
              ...(input.isComponent === undefined ? {} : { isComponent: input.isComponent }),
              ...(input.isEvaluator === undefined ? {} : { isEvaluator: input.isEvaluator }),
            },
          });
        },

        listPublishedComponents: async (
          _ctx: unknown,
          input: Readonly<{ projectId: string }>,
        ) => {
          const workflows = await prisma.workflow.findMany({
            where: {
              projectId: input.projectId,
              OR: [{ isComponent: true }, { isEvaluator: true }],
            },
            include: { versions: true },
          });

          // Each component carries only the version it publishes; the studio
          // picks a component by its published shape, never by a draft.
          workflows.forEach((workflow) => {
            workflow.versions = workflow.versions.filter(
              (version) => version.id === workflow.publishedId,
            );
          });

          return workflows;
        },
      },
    },
  };
}

/**
 * The slug `/annotations/<slug>` addresses, for a queue name.
 *
 * Written here rather than imported: the platform's helper took a whole
 * slugify library for one call, and the rule is two substitutions — the
 * underscore a queue name may carry becomes a dash, and everything that is not
 * a URL-safe word character collapses to one.
 */
function annotationQueueSlug(name: string): string {
  return name
    .replace("_", "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
