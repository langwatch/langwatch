/**
 * The project itself over the process's tRPC transport.
 *
 *   create:                  provisions a project into an existing team, or
 *                            into a team created alongside it.
 *   getProjectAPIKey:        the project row behind the settings page, base
 *                            key included.
 *   getHasFirstMessage:      whether the project has ever received a trace,
 *                            which is what the setup screens wait on.
 *   regenerateApiKey:        rotates the legacy project write credential.
 *   update:                  the project settings form, stored-object
 *                            credentials included.
 *   getFieldRedactionStatus: whether this viewer may read captured input and
 *                            output, and who can if they may not.
 *   archiveById:             archives a DIFFERENT project than the one the
 *                            caller is currently in.
 *   triggerTopicClustering:  asks the scheduler for a manual clustering run.
 *
 * Transport only: gates, audit, and delegation to `ProjectService` and the
 * cross-feature services the process composes. Every process capability this
 * surface needs that is not the project's own — encryption, the caller's
 * content protections, an imperative permission probe, Langy's virtual key,
 * the audit trail and the error reporter — arrives as a port.
 *
 * Spec: packages/features/project/specs/project-service.feature.
 */
import { ApiKeyNotFoundError, type ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectService,
} from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/**
 * The scheduler command a manual clustering request is sent as. Named
 * structurally rather than imported, because the command lives in the topic
 * feature's own server package and this surface only ever sends one.
 */
type TopicClusteringCommands = Readonly<{
  requestClustering(
    input: Readonly<{
      tenantId: string;
      occurredAt: number;
      trigger: "manual";
      requestedByUserId: string;
    }>,
  ): Promise<void>;
}>;

type ProjectApplication = Readonly<{
  projects: ProjectService;
  apiKeys: ApiKeyService;
  share: ShareService;
  topics: TopicService;
  topicClustering: TopicClusteringCommands;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type ProjectTrpcContext = Readonly<{
  app: ProjectApplication;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * The viewer's content visibility for one project, as the process's own
 * protections resolver answers it. Only the four fields this surface renders
 * are named; the resolver returns more.
 */
export type ProjectFieldProtections = Readonly<{
  canSeeCapturedInput?: boolean | null | undefined;
  canSeeCapturedOutput?: boolean | null | undefined;
  capturedInputVisibleTo?: string | null | undefined;
  capturedOutputVisibleTo?: string | null | undefined;
}>;

type ProjectTrpcProcedures<
  TContext extends ProjectTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all. The same
   * holds for the two decorators below.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
  /**
   * `create`'s own declaration, because it is the one procedure here whose
   * authorized target depends on what was asked for: creating INTO a team
   * asks that team for `project:create`, and creating a team alongside asks
   * the organization for `organization:manage`. Neither fixed tier could
   * express it, so the process declares the custom check.
   */
  createPolicy<TProcedure>(procedure: TProcedure): TProcedure;
  /**
   * `update`'s declared `project:update` plus the process's trace-sharing
   * gate: flipping `traceSharingEnabled` additionally requires
   * `project:manage`, because it changes who outside the project can read its
   * traces. Every other field on the form stays at `project:update`.
   */
  updatePolicy<TProcedure>(procedure: TProcedure): TProcedure;
}>;

/**
 * The process capabilities this transport needs that are not the project's
 * own. Each is handed the request context where the process resolves the
 * caller from it, exactly as it did before this surface moved.
 */
type ProjectTrpcPorts = Readonly<{
  /** The process's secret encryption, for the stored-object credentials. */
  encryptProjectSecret(value: string): string;
  /**
   * Whether the caller holds `permission` on a project OTHER than the one the
   * declared check already resolved. `archiveById` names two projects and
   * acts on the second.
   */
  probeProjectPermission(
    ctx: ProjectTrpcContext,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /** The caller's captured-content visibility for the project. */
  getFieldProtections(
    ctx: ProjectTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<ProjectFieldProtections>;
  /**
   * Mints Langy's gateway virtual key for a freshly created project, so it is
   * in the user's list from day one. Best effort by contract: the process
   * reports a failure and never lets it fail the creation, because the
   * credential service re-attempts on the first chat call.
   */
  provisionLangyVirtualKey(
    ctx: ProjectTrpcContext,
    input: Readonly<{ projectId: string; organizationId: string; actorUserId: string }>,
  ): Promise<void>;
  /**
   * The process's audit trail for the key rotation. Best effort by contract:
   * an audit failure must not stop the new key reaching the caller who just
   * rotated it.
   */
  recordApiKeyRegenerated(entry: Readonly<{ userId: string; projectId: string }>): Promise<void>;
  /** The process's error reporter for a clustering request that did not land. */
  reportTopicClusteringFailure(error: unknown, context: Readonly<{ projectId: string }>): void;
}>;

const projectScopeSchema = z.object({ projectId: z.string() });

const createInputSchema = z.object({
  organizationId: z.string(),
  teamId: z.string().optional(),
  newTeamName: z.string().optional(),
  name: z.string(),
  language: z.string(),
  framework: z.string(),
});

/**
 * The stored-object credentials are all-or-nothing: a half-filled set would
 * persist an endpoint the project cannot actually reach.
 */
const updateInputSchema = z
  .object({
    projectId: z.string(),
    name: z.string().optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
    teamId: z.string().optional(),
    traceSharingEnabled: z.boolean().optional(),
    presenceEnabled: z.boolean().optional(),
    userLinkTemplate: z.string().optional(),
    s3Endpoint: z.string().optional(),
    s3AccessKeyId: z.string().optional(),
    s3SecretAccessKey: z.string().optional(),
    s3Bucket: z.string().optional(),
  })
  .refine((data) => {
    const hasEndpoint = !!data.s3Endpoint?.trim();
    const hasAccessKey = !!data.s3AccessKeyId?.trim();
    const hasSecretKey = !!data.s3SecretAccessKey?.trim();

    return (
      (hasEndpoint && hasAccessKey && hasSecretKey) ||
      (!hasEndpoint && !hasAccessKey && !hasSecretKey)
    );
  });

const archiveByIdInputSchema = z.object({
  projectId: z.string(),
  projectToArchiveId: z.string(),
});

/**
 * Installs the complete `project.*` tRPC surface on a process-owned root. The
 * procedure and the policies are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class ProjectTrpcApi {
  static create<
    TContext extends ProjectTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ProjectTrpcProcedures<TContext, TOptions, TRoot>,
    ports: ProjectTrpcPorts,
  ) {
    const { protected: procedure, policy, createPolicy, updatePolicy } = procedures;

    return trpc.router({
      /**
       * The owner is ADMIN of their own personal team, so `project:create`
       * passes there. A personal workspace holds only the project provisioned
       * with it, which is what `PersonalWorkspaceBoundaryError` refuses.
       */
      create: createPolicy(procedure.input(createInputSchema)).mutation(async ({ input, ctx }) => {
        const userId = ctx.actor().id;
        let project;
        try {
          project = await ctx.app.projects.create({
            organizationId: input.organizationId,
            userId,
            teamId: input.teamId,
            newTeamName: input.newTeamName,
            name: input.name,
            language: input.language,
            framework: input.framework,
          });
        } catch (error) {
          if (error instanceof TeamNotInOrganizationError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          if (error instanceof PersonalWorkspaceBoundaryError) {
            throw new TRPCError({ code: "FORBIDDEN", message: error.message });
          }
          if (error instanceof ProjectSlugConflictError) {
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          }
          throw error;
        }

        // (The eager per-project Langy service key that used to be minted
        // here is gone — Langy now mints a per-turn, per-user session key
        // scoped to exactly what the caller holds; no long-lived project key
        // is provisioned.)
        await ports.provisionLangyVirtualKey(ctx, {
          projectId: project.id,
          organizationId: input.organizationId,
          actorUserId: userId,
        });

        return { success: true, projectSlug: project.slug };
      }),

      /**
       * The base key is a project-level write credential, so reading it is
       * gated with `project:update` to match the access it grants. Rotation
       * stays at `project:manage`.
       */
      getProjectAPIKey: policy("project:update")(procedure.input(projectScopeSchema)).query(
        async ({ input, ctx }) => {
          const project = await ctx.app.projects.tryGetById(input.projectId);

          if (!project) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Project not found",
            });
          }

          return project;
        },
      ),

      getHasFirstMessage: policy("project:view")(procedure.input(projectScopeSchema)).query(
        async ({ input, ctx }) => {
          const project = await ctx.app.projects.tryGetById(input.projectId);

          return { firstMessage: project?.firstMessage ?? false };
        },
      ),

      regenerateApiKey: policy("project:manage")(procedure.input(projectScopeSchema)).mutation(
        async ({ input, ctx }) => {
          try {
            const apiKey = await ctx.app.apiKeys.regenerateLegacyProjectKey({
              projectId: input.projectId,
            });

            // Audit log the security-critical action; non-fatal so an audit
            // failure cannot prevent returning the new key to the user.
            await ports.recordApiKeyRegenerated({
              userId: ctx.actor().id,
              projectId: input.projectId,
            });

            return { apiKey };
          } catch (error) {
            if (error instanceof ProjectNotFoundError || error instanceof ApiKeyNotFoundError) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Project not found",
              });
            }
            throw error;
          }
        },
      ),

      update: updatePolicy(procedure.input(updateInputSchema)).mutation(async ({ input, ctx }) => {
        const project = await ctx.app.projects.tryGetWithTeam(input.projectId);

        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        let updatedProject;
        try {
          updatedProject = await ctx.app.projects.update({
            id: input.projectId,
            organizationId: project.team.organizationId,
            data: {
              ...(input.name !== undefined && { name: input.name }),
              ...(input.language !== undefined && { language: input.language }),
              ...(input.framework !== undefined && { framework: input.framework }),
              ...(input.userLinkTemplate !== undefined && {
                userLinkTemplate: input.userLinkTemplate,
              }),
              ...(input.teamId && { teamId: input.teamId }),
              traceSharingEnabled: input.traceSharingEnabled,
              presenceEnabled: input.presenceEnabled,
              s3Endpoint: input.s3Endpoint ? ports.encryptProjectSecret(input.s3Endpoint) : null,
              s3AccessKeyId: input.s3AccessKeyId
                ? ports.encryptProjectSecret(input.s3AccessKeyId)
                : null,
              s3SecretAccessKey: input.s3SecretAccessKey
                ? ports.encryptProjectSecret(input.s3SecretAccessKey)
                : null,
              s3Bucket: input.s3Bucket,
            },
          });
        } catch (error) {
          if (error instanceof DestinationTeamNotFoundError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          if (error instanceof PersonalWorkspaceBoundaryError) {
            throw new TRPCError({ code: "FORBIDDEN", message: error.message });
          }
          if (error instanceof ProjectNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          }
          throw error;
        }

        // If trace sharing was disabled, revoke all existing trace shares
        if (input.traceSharingEnabled === false && project.traceSharingEnabled === true) {
          await ctx.app.share.revokeAllTraceShares(input.projectId);
        }

        return { success: true, projectSlug: updatedProject.slug };
      }),

      // Legacy default-model mutations have been removed alongside the
      // Organization/Team/Project scalar columns they wrote to. Defaults
      // now live in ModelDefaultConfig; the canonical mutation surface is
      // modelProvider.{saveDefaultModelsConfig,deleteDefaultModelsConfig,setRoleAssignmentForScope,
      // setFeatureOverrideForScope}.
      getFieldRedactionStatus: policy("project:view")(procedure.input(projectScopeSchema)).query(
        async ({ input, ctx }) => {
          const protections = await ports.getFieldProtections(ctx, {
            projectId: input.projectId,
          });

          return {
            isRedacted: {
              input: !protections.canSeeCapturedInput,
              output: !protections.canSeeCapturedOutput,
            },
            // Human label of who CAN see a restricted field (e.g. "Admins,
            // Security" or "no one"), so the redaction placeholder can explain
            // why content is hidden and who to ask. Null when the field is
            // visible.
            visibleTo: {
              input: protections.capturedInputVisibleTo ?? null,
              output: protections.capturedOutputVisibleTo ?? null,
            },
          };
        },
      ),

      archiveById: policy("project:delete")(procedure.input(archiveByIdInputSchema)).mutation(
        async ({ input, ctx }) => {
          if (input.projectToArchiveId === input.projectId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "You cannot archive the current project",
            });
          }
          // The declared check covered `projectId`, the project the caller is
          // in. The project actually archived is the other one, so it is
          // probed on its own before anything is read or written.
          const canDeleteTarget = await ports.probeProjectPermission(
            ctx,
            input.projectToArchiveId,
            "project:delete",
          );
          if (!canDeleteTarget) {
            throw new TRPCError({ code: "UNAUTHORIZED" });
          }

          const target = await ctx.app.projects.tryGetWithTeam(input.projectToArchiveId);
          if (!target) return { success: true, alreadyArchived: true };

          try {
            await ctx.app.projects.archive({
              id: input.projectToArchiveId,
              organizationId: target.team.organizationId,
            });
            return { success: true, alreadyArchived: false };
          } catch (error) {
            if (error instanceof PersonalProjectProtectedError) {
              throw new TRPCError({ code: "FORBIDDEN", message: error.message });
            }
            if (error instanceof ProjectNotFoundError) {
              return { success: true, alreadyArchived: true };
            }
            throw error;
          }
        },
      ),

      triggerTopicClustering: policy("project:update")(
        procedure.input(projectScopeSchema),
      ).mutation(async ({ ctx, input }) => {
        try {
          // A request made while a run is already underway is declined by the
          // scheduler, not queued behind it, so an unconditional success would
          // tell the user a run started when nothing did. The read model is the
          // only place that answer is visible before the scheduler makes it, so
          // ask it first and report which of the two the click actually did.
          // Best effort by nature: the scheduler, not this check, is what keeps
          // two runs off one project.
          if ((await ctx.app.topics.getClusteringStatus(input)).isRunInFlight) {
            return {
              started: false as const,
              reason: "already_running" as const,
            };
          }
          await ctx.app.topicClustering.requestClustering({
            tenantId: input.projectId,
            occurredAt: Date.now(),
            trigger: "manual",
            requestedByUserId: ctx.actor().id,
          });
          return { started: true as const };
        } catch (error) {
          ports.reportTopicClusteringFailure(error, { projectId: input.projectId });
          // The UI toasts this message verbatim, and the failures behind it are
          // event-store/projection internals (Prisma detail, hostnames) — the
          // same class of text the status read deliberately never exposes.
          // Detail goes to the report above; the customer gets a fixed sentence.
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to trigger topic clustering",
          });
        }
      }),
    });
  }
}
