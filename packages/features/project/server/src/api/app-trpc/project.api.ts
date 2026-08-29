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
 * Transport only: gates, audit, and delegation to {@link ProjectApp}. Every
 * process capability this surface needs that is not the project's own —
 * encryption, the caller's content protections, an imperative permission
 * probe, Langy's virtual key, the audit trail and the error reporter — arrives
 * as a port.
 *
 * Nothing here constructs a transport error. The project's named refusals are
 * handled errors carrying their own status, so the process's handled-error
 * middleware derives the tRPC code from the cause rather than from a
 * translation table kept here and a second one kept by the REST family.
 *
 * Spec: packages/features/project/specs/project-service.feature.
 */
import {
  ProjectPermissionDeniedError,
  type AuthzPermission,
} from "@langwatch/authz-contract";
import {
  CannotArchiveCurrentProjectError,
  ProjectNotFoundError,
} from "@langwatch/project-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { ProjectApp } from "#app/project.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type ProjectTrpcContext = Readonly<{
  app: Readonly<{ projects: ProjectApp }>;
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
        const actor = ctx.actor();
        const project = await ctx.app.projects.create(
          {
            organizationId: input.organizationId,
            teamId: input.teamId,
            newTeamName: input.newTeamName,
            name: input.name,
            language: input.language,
            framework: input.framework,
          },
          actor,
        );

        // (The eager per-project Langy service key that used to be minted
        // here is gone — Langy now mints a per-turn, per-user session key
        // scoped to exactly what the caller holds; no long-lived project key
        // is provisioned.)
        await ports.provisionLangyVirtualKey(ctx, {
          projectId: project.id,
          organizationId: input.organizationId,
          actorUserId: actor.id,
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

          if (!project) throw new ProjectNotFoundError();

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
          const apiKey = await ctx.app.projects.regenerateLegacyProjectKey({
            projectId: input.projectId,
          });

          // Audit log the security-critical action; non-fatal so an audit
          // failure cannot prevent returning the new key to the user.
          await ports.recordApiKeyRegenerated({
            userId: ctx.actor().id,
            projectId: input.projectId,
          });

          return { apiKey };
        },
      ),

      update: updatePolicy(procedure.input(updateInputSchema)).mutation(async ({ input, ctx }) => {
        const updatedProject = await ctx.app.projects.updateSettings({
          projectId: input.projectId,
          name: input.name,
          language: input.language,
          framework: input.framework,
          teamId: input.teamId,
          traceSharingEnabled: input.traceSharingEnabled,
          presenceEnabled: input.presenceEnabled,
          userLinkTemplate: input.userLinkTemplate,
          s3Endpoint: input.s3Endpoint ? ports.encryptProjectSecret(input.s3Endpoint) : null,
          s3AccessKeyId: input.s3AccessKeyId
            ? ports.encryptProjectSecret(input.s3AccessKeyId)
            : null,
          s3SecretAccessKey: input.s3SecretAccessKey
            ? ports.encryptProjectSecret(input.s3SecretAccessKey)
            : null,
          s3Bucket: input.s3Bucket,
        });

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
            throw new CannotArchiveCurrentProjectError();
          }
          // The declared check covered `projectId`, the project the caller is
          // in. The project actually archived is the other one, so it is
          // probed on its own before anything is read or written.
          const canDeleteTarget = await ports.probeProjectPermission(
            ctx,
            input.projectToArchiveId,
            "project:delete",
          );
          if (!canDeleteTarget) throw new ProjectPermissionDeniedError("project:delete");

          const { alreadyArchived } = await ctx.app.projects.archive({
            projectId: input.projectToArchiveId,
          });
          return { success: true, alreadyArchived };
        },
      ),

      triggerTopicClustering: policy("project:update")(
        procedure.input(projectScopeSchema),
      ).mutation(async ({ ctx, input }) => {
        try {
          return await ctx.app.projects.requestTopicClustering(input, ctx.actor());
        } catch (error) {
          ports.reportTopicClusteringFailure(error, { projectId: input.projectId });
          // The failures behind this are event-store and projection internals
          // — Prisma detail, hostnames — which is a cause we cannot name and
          // the caller cannot act on. It stays an ordinary error so the
          // boundary degrades it to an unknown failure carrying a trace id
          // rather than dressing an infrastructure fault up as handled.
          throw new Error("Failed to trigger topic clustering", { cause: error });
        }
      }),
    });
  }
}
