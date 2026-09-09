/**
 * The server half of `project.*`: one project's lifecycle and its settings.
 * Every deployment capability the surface needs beside the project's own is
 * named on {@link ProjectBrowserApi}, and nothing here constructs a transport
 * error — the project's refusals carry their own status.
 * Spec: modules/project/specs/project-service.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ProjectPermissionDeniedError, type AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  CannotArchiveCurrentProjectError,
  ProjectCreateDeniedError,
  ProjectCreateTargetMissingError,
  ProjectNotFoundError,
  TraceSharingDeniedError,
  projectTrpc,
  type ProjectApi,
} from "@langwatch/project-contract";
import { moduleApi } from "@langwatch/runtime-composition";

/** A scope a probe is asked at, when the declaration resolved a different one. */
export type ProjectPermissionScope = Readonly<{
  tier: "project" | "team" | "organization";
  id: string;
}>;

/**
 * The viewer's content visibility for one project, as the deployment's own
 * protections resolver answers it. Only the four fields this surface renders
 * are named; the resolver returns more.
 */
export type ProjectFieldProtections = Readonly<{
  canSeeCapturedInput?: boolean | null | undefined;
  canSeeCapturedOutput?: boolean | null | undefined;
  capturedInputVisibleTo?: string | null | undefined;
  capturedOutputVisibleTo?: string | null | undefined;
}>;

/**
 * What the project's own browser door reaches: the project application, and
 * the six deployment answers the surface needs beside it. Each is asked of the
 * request the mount built this for, so the caller is the mount's to resolve.
 */
export interface ProjectBrowserApi {
  /** This module's own application, as the process composed it. */
  projects(): ProjectApi;
  /** The deployment's secret encryption, for the stored-object credentials. */
  encryptProjectSecret(value: string): string;
  /**
   * Whether the caller holds `permission` at a scope the declared check did
   * not resolve: the team or organization a create names, and the OTHER
   * project an archive acts on.
   */
  probePermission(input: {
    permission: AuthzPermission;
    scope: ProjectPermissionScope;
  }): Promise<boolean>;
  /** The caller's captured-content visibility for the project. */
  getFieldProtections(input: { projectId: string }): Promise<ProjectFieldProtections>;
  /**
   * Mints Langy's gateway virtual key for a freshly created project. Best
   * effort by contract: a failure is reported and never fails the creation,
   * because the credential service re-attempts on the first chat call.
   */
  provisionLangyVirtualKey(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void>;
  /**
   * The deployment's audit trail for the key rotation. Best effort: an audit
   * failure must not stop the new key reaching the caller who rotated it.
   */
  recordApiKeyRegenerated(entry: { userId: string; projectId: string }): Promise<void>;
  /** The deployment's error reporter for a clustering request that did not land. */
  reportTopicClusteringFailure(error: unknown, context: { projectId: string }): void;
}

export const ProjectBrowserApi = moduleApi<ProjectBrowserApi>("project");

/**
 * `create`'s standing depends on what was asked for, so no single permission
 * at one scope states it: creating INTO a team asks that team for
 * `project:create`, and creating a team alongside asks the organization for
 * `organization:manage`. The handler resolves the tier and asks.
 */
const CREATE_RESOLVES_ITS_OWN_TIER =
  "creating INTO a team asks that team for project:create; creating a team alongside asks the organization for organization:manage, and which of the two was asked for is only known once the input is parsed";

export const projectTrpcTransport = defineTrpcRouter(ProjectBrowserApi, projectTrpc)
  /**
   * The owner is ADMIN of their own personal team, so `project:create` passes
   * there. A personal workspace holds only the project provisioned with it,
   * which is what `PersonalWorkspaceBoundaryError` refuses.
   */
  .procedure("create")
  .serviceAuthorized({
    reason: CREATE_RESOLVES_ITS_OWN_TIER,
    permissions: ["project:create", "organization:manage"],
    enforces: {
      teamId: "requireCreateStanding asks the named team for project:create",
      organizationId:
        "requireCreateStanding asks the organization for organization:manage when a team is created alongside",
    },
  })
  .handle(async ({ app, input, actor }) => {
    await requireCreateStanding({ app, input });

    const project = await app.projects().create(
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

    await app.provisionLangyVirtualKey({
      projectId: project.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
    });

    return { success: true as const, projectSlug: project.slug };
  })

  /**
   * The base key is a project-level write credential, so reading it is gated
   * with `project:update` to match the access it grants. Rotation stays at
   * `project:manage`.
   */
  .procedure("getProjectAPIKey")
  .withPermission("project:update")
  .handle(async ({ app, input }) => {
    const project = await app.projects().tryGetById(input.projectId);

    if (!project) throw new ProjectNotFoundError();

    return project;
  })

  .procedure("getHasFirstMessage")
  .withPermission("project:view")
  .handle(async ({ app, input }) => {
    const project = await app.projects().tryGetById(input.projectId);

    return { firstMessage: project?.firstMessage ?? false };
  })

  .procedure("regenerateApiKey")
  .withPermission("project:manage")
  .handle(async ({ app, input, actor }) => {
    const apiKey = await app.projects().regenerateLegacyProjectKey({
      projectId: input.projectId,
    });

    // Audit the security-critical action; non-fatal, so an audit failure
    // cannot prevent returning the new key to the caller.
    await app.recordApiKeyRegenerated({ userId: actor.id, projectId: input.projectId });

    return { apiKey };
  })

  /**
   * `project:update` for the form, plus `project:manage` for the one field
   * that changes who OUTSIDE the project can read its traces.
   */
  .procedure("update")
  .withPermission("project:update")
  .handle(async ({ app, input }) => {
    await requireTraceSharingStanding({ app, input });

    const updatedProject = await app.projects().updateSettings({
      projectId: input.projectId,
      name: input.name,
      language: input.language,
      framework: input.framework,
      teamId: input.teamId,
      traceSharingEnabled: input.traceSharingEnabled,
      presenceEnabled: input.presenceEnabled,
      userLinkTemplate: input.userLinkTemplate,
      s3Endpoint: input.s3Endpoint ? app.encryptProjectSecret(input.s3Endpoint) : null,
      s3AccessKeyId: input.s3AccessKeyId ? app.encryptProjectSecret(input.s3AccessKeyId) : null,
      s3SecretAccessKey: input.s3SecretAccessKey
        ? app.encryptProjectSecret(input.s3SecretAccessKey)
        : null,
      s3Bucket: input.s3Bucket,
    });

    return { success: true, projectSlug: updatedProject.slug };
  })

  .procedure("getFieldRedactionStatus")
  .withPermission("project:view")
  .handle(async ({ app, input }) => {
    const protections = await app.getFieldProtections({ projectId: input.projectId });

    return {
      isRedacted: {
        input: !protections.canSeeCapturedInput,
        output: !protections.canSeeCapturedOutput,
      },
      // Human label of who CAN see a restricted field (e.g. "Admins,
      // Security" or "no one"), so the redaction placeholder can explain why
      // content is hidden and who to ask. Null when the field is visible.
      visibleTo: {
        input: protections.capturedInputVisibleTo ?? null,
        output: protections.capturedOutputVisibleTo ?? null,
      },
    };
  })

  .procedure("archiveById")
  .withPermission("project:delete")
  .handle(async ({ app, input }) => {
    if (input.projectToArchiveId === input.projectId) {
      throw new CannotArchiveCurrentProjectError();
    }

    // The declared check covered `projectId`, the project the caller is in.
    // The project actually archived is the other one, so it is probed on its
    // own before anything is read or written.
    const canDeleteTarget = await app.probePermission({
      permission: "project:delete",
      scope: { tier: "project", id: input.projectToArchiveId },
    });

    if (!canDeleteTarget) throw new ProjectPermissionDeniedError("project:delete");

    const { alreadyArchived } = await app.projects().archive({
      projectId: input.projectToArchiveId,
    });

    return { success: true as const, alreadyArchived };
  })

  .procedure("triggerTopicClustering")
  .withPermission("project:update")
  .handle(async ({ app, input, actor }) => {
    try {
      return await app.projects().requestTopicClustering(input, actor);
    } catch (error) {
      app.reportTopicClusteringFailure(error, { projectId: input.projectId });
      // A refusal the deployment already named — one that composes no
      // clustering scheduler is what reaches here — is re-raised untouched.
      // Its cause is known and its caller can act on it, so wrapping it would
      // spend a name the boundary would then report as a trace id.
      if (HandledError.isHandled(error)) throw error;
      // Everything else behind this is event-store and projection internals,
      // which is a cause we cannot name and the caller cannot act on. It stays
      // an ordinary error so the boundary degrades it to an unknown failure
      // carrying a trace id rather than dressing an infrastructure fault up as
      // handled.
      throw new Error("Failed to trigger topic clustering", { cause: error });
    }
  })
  .build();

/**
 * The tier a create is judged at, resolved from what it asked for. A request
 * naming neither an existing team nor a new one names no scope at all, so it
 * is refused before any standing is asked about.
 */
async function requireCreateStanding({
  app,
  input,
}: {
  app: ProjectBrowserApi;
  input: Readonly<{
    organizationId: string;
    teamId?: string | undefined;
    newTeamName?: string | undefined;
  }>;
}): Promise<void> {
  if (!input.teamId && !input.newTeamName) throw new ProjectCreateTargetMissingError();

  const permitted = input.teamId
    ? await app.probePermission({
        permission: "project:create",
        scope: { tier: "team", id: input.teamId },
      })
    : await app.probePermission({
        permission: "organization:manage",
        scope: { tier: "organization", id: input.organizationId },
      });

  if (!permitted) throw new ProjectCreateDeniedError();
}

/**
 * Flipping `traceSharingEnabled` changes who outside the project can read its
 * traces, so it demands `project:manage` on top of the `project:update` the
 * declaration already resolved. Every other field on the form does not.
 */
async function requireTraceSharingStanding({
  app,
  input,
}: {
  app: ProjectBrowserApi;
  input: Readonly<{ projectId: string; traceSharingEnabled?: boolean | undefined }>;
}): Promise<void> {
  if (input.traceSharingEnabled === undefined) return;

  const permitted = await app.probePermission({
    permission: "project:manage",
    scope: { tier: "project", id: input.projectId },
  });

  if (!permitted) throw new TraceSharingDeniedError();
}
