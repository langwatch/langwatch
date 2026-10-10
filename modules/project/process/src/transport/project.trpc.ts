/**
 * The server half of `project.*`: one project's lifecycle and its settings.
 * Every other deployment capability is named on {@link ProjectBrowserApi};
 * nothing here constructs a transport error. Spec: modules/project/specs/project-service.feature.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import {
  ProjectCreateDeniedError,
  ProjectCreateTargetMissingError,
  TraceSharingDeniedError,
  hasTracesToShow,
  isAggregateProjectKind,
  projectTrpc,
  type AggregateMemberCandidate,
  type AggregateRule,
  type AggregateRuleMembers,
  type ProjectApi,
} from "@langwatch/project-contract";

/** A scope a probe is asked at, when the declaration resolved a different one. */
export type ProjectPermissionScope = Readonly<{
  tier: "project" | "team" | "organization";
  id: string;
}>;

/**
 * What the project's own browser door reaches: the project application, and
 * the four deployment answers the surface needs beside it. Each is asked of the
 * request the mount built this for, so the caller is the mount's to resolve.
 */
export interface ProjectBrowserApi {
  /** This module's own application, as the process composed it. */
  projects(): ProjectApi;
  /**
   * Whether `by` holds `permission` at a scope the declared check did not
   * resolve — the team/organization a create names, or the OTHER project an
   * archive acts on. `by` travels as an argument: one app instance answers every request.
   */
  probePermission(input: {
    permission: AuthzPermission;
    scope: ProjectPermissionScope;
    by: Readonly<{ id: string }>;
  }): Promise<boolean>;
  /** Archives a project other than the one the caller is in, after probing it on its own. */
  archiveOtherProject(input: {
    projectId: string;
    projectToArchiveId: string;
    by: Readonly<{ id: string }>;
  }): Promise<{ alreadyArchived: boolean }>;
  /** Whether the legacy project key still authenticates; never the key. */
  getLegacyKeyStatus(input: { projectId: string }): Promise<{ present: boolean }>;
  /** Revokes the legacy project key for good, audited; no key is returned. */
  revokeProjectApiKey(input: { projectId: string; by: Readonly<{ id: string }> }): Promise<void>;
  /** ADR-177: an organisation admin replaces an aggregate's rule; its members answer pending. */
  updateAggregateRule(input: {
    projectId: string;
    aggregateRule: AggregateRule;
    by: Readonly<{ id: string }>;
  }): Promise<AggregateRuleMembers>;
  /** ADR-177: what an explicit rule may name, owners included; organisation admins only. */
  aggregateMemberCandidates(input: {
    organizationId: string;
    by: Readonly<{ id: string }>;
  }): Promise<AggregateMemberCandidate[]>;
}

export const ProjectBrowserApi = moduleApi<ProjectBrowserApi>()("project");

/**
 * `create`'s standing depends on what was asked for: creating INTO a team
 * asks that team for `project:create`; creating a team alongside asks the
 * organization for `organization:manage`. The handler resolves the tier.
 */
const CREATE_RESOLVES_ITS_OWN_TIER =
  "creating INTO a team asks that team for project:create; creating a team alongside asks the organization for organization:manage, and which of the two was asked for is only known once the input is parsed";

export const projectTrpcTransport: TrpcRouterDeclaration<ProjectBrowserApi, typeof projectTrpc> =
  defineTrpcRouter(ProjectBrowserApi, projectTrpc)
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
      await createStanding({ app, input, actor });

      const project = await app.projects().create(
        {
          organizationId: input.organizationId,
          teamId: input.teamId,
          newTeamName: input.newTeamName,
          name: input.name,
          language: input.language,
          framework: input.framework,
          kind: input.kind,
          aggregateRule: input.aggregateRule,
        },
        actor,
      );

      return { success: true as const, projectSlug: project.slug };
    })

    .procedure("getHasFirstMessage")
    .withPermission("project:view")
    .handle(async ({ app, input }) => {
      const project = await app.projects().findById(input.projectId);

      return { firstMessage: project ? hasTracesToShow(project) : false };
    })

    .procedure("getLegacyKeyStatus")
    .withPermission("project:manage")
    .handle(({ app, input }) => app.getLegacyKeyStatus({ projectId: input.projectId }))

    .procedure("revokeProjectApiKey")
    .withPermission("project:manage")
    .handle(async ({ app, input, actor }) => {
      await app.revokeProjectApiKey({ projectId: input.projectId, by: actor });

      return { revoked: true as const };
    })

    /**
     * `project:update` for the form, plus `project:manage` for the one field
     * that changes who OUTSIDE the project can read its traces.
     */
    .procedure("update")
    .withPermission("project:update")
    .handle(async ({ app, input, actor }) => {
      await traceSharingStanding({ app, input, actor });
      if (input.traceSharingEnabled !== undefined) {
        await app.projects().setTraceSharing({
          projectId: input.projectId,
          enabled: input.traceSharingEnabled,
          revokeExistingLinks: input.revokeExistingLinks ?? true,
          by: { id: actor.id },
        });
      }

      const updatedProject = await app.projects().updateSettings(
        {
          projectId: input.projectId,
          name: input.name,
          language: input.language,
          framework: input.framework,
          teamId: input.teamId,
          presenceEnabled: input.presenceEnabled,
          userLinkTemplate: input.userLinkTemplate,
          s3Endpoint: input.s3Endpoint || null,
          s3AccessKeyId: input.s3AccessKeyId || null,
          // A blank secret beside an endpoint leaves the stored one unchanged.
          ...(input.s3SecretAccessKey || !input.s3Endpoint
            ? { s3SecretAccessKey: input.s3SecretAccessKey || null }
            : {}),
          s3Bucket: input.s3Bucket,
        },
        actor,
      );

      return { success: true, projectSlug: updatedProject.slug };
    })

    .procedure("archiveById")
    .withPermission("project:delete")
    .handle(async ({ app, input, actor }) => {
      const { alreadyArchived } = await app.archiveOtherProject({
        projectId: input.projectId,
        projectToArchiveId: input.projectToArchiveId,
        by: actor,
      });

      return { success: true as const, alreadyArchived };
    })

    /** The service refuses anyone but an organisation admin (ADR-177 decision 5). */
    .procedure("updateAggregateRule")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) => {
      const members = await app.updateAggregateRule({
        projectId: input.projectId,
        aggregateRule: input.aggregateRule,
        by: actor,
      });

      return { success: true as const, members };
    })

    .procedure("aggregateMemberCandidates")
    .withPermission("organization:manage")
    .handle(({ app, input, actor }) =>
      app.aggregateMemberCandidates({ organizationId: input.organizationId, by: actor }),
    )
    .build();

/**
 * The tier a create is judged at, resolved from what it asked for. A request
 * naming neither an existing team nor a new one names no scope at all, so it
 * is refused before any standing is asked about.
 */
async function createStanding({
  app,
  input,
  actor,
}: {
  app: ProjectBrowserApi;
  input: Readonly<{
    organizationId: string;
    teamId?: string | undefined;
    newTeamName?: string | undefined;
    kind?: string | undefined;
  }>;
  actor: Readonly<{ id: string }>;
}): Promise<void> {
  if (!input.teamId && !input.newTeamName) throw new ProjectCreateTargetMissingError();

  // An aggregate reads other people's personal projects: it asks the organization wherever it sits.
  const permitted =
    input.teamId && !isAggregateProjectKind(input.kind)
      ? await app.probePermission({
          permission: "project:create",
          scope: { tier: "team", id: input.teamId },
          by: actor,
        })
      : await app.probePermission({
          permission: "organization:manage",
          scope: { tier: "organization", id: input.organizationId },
          by: actor,
        });

  if (!permitted) throw new ProjectCreateDeniedError();
}

/**
 * Flipping `traceSharingEnabled` changes who outside the project can read its
 * traces, so it demands `project:manage` on top of the `project:update` the
 * declaration already resolved. Every other field on the form does not.
 */
async function traceSharingStanding({
  app,
  input,
  actor,
}: {
  app: ProjectBrowserApi;
  input: Readonly<{ projectId: string; traceSharingEnabled?: boolean | undefined }>;
  actor: Readonly<{ id: string }>;
}): Promise<void> {
  if (input.traceSharingEnabled === undefined) return;

  const permitted = await app.probePermission({
    permission: "project:manage",
    scope: { tier: "project", id: input.projectId },
    by: actor,
  });

  if (!permitted) throw new TraceSharingDeniedError();
}
