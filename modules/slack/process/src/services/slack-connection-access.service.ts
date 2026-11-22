import { PermissionDeniedError } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SlackConnectionInUseError } from "@langwatch/slack-contract";

import type { SlackConnectionClaimRepository } from "../repositories/slack-connection-claim.repository.ts";
import type {
  SlackConnectionRow,
  SlackScope,
} from "../repositories/slack-connection.repository.ts";

type SlackConnectionAccessDeps = Readonly<{
  claims: SlackConnectionClaimRepository;
  projects: Pick<ProjectApi, "listNamesByIds">;
  authorization: Pick<AuthzApi, "hasPermission">;
}>;

/** Who may manage a Slack connection and which projects reach it. */
export class SlackConnectionAccessService {
  private constructor(private readonly deps: SlackConnectionAccessDeps) {}

  static create(deps: SlackConnectionAccessDeps): SlackConnectionAccessService {
    return new SlackConnectionAccessService(deps);
  }

  /** PROJECT connections need `project:update` there, ORGANIZATION ones `organization:manage`. */
  async assertManage({ actorId, target }: { actorId: string; target: SlackScope }): Promise<void> {
    const permitted =
      target.scopeType === "ORGANIZATION"
        ? await this.deps.authorization.hasPermission({
            userId: actorId,
            permission: "organization:manage",
            organizationId: target.scopeId,
          })
        : await this.deps.authorization.hasPermission({
            userId: actorId,
            permission: "project:update",
            projectId: target.scopeId,
          });
    if (permitted) return;
    throw new PermissionDeniedError({
      permission: target.scopeType === "ORGANIZATION" ? "organization:manage" : "project:update",
      scope: {
        type: target.scopeType === "ORGANIZATION" ? "organization" : "project",
        id: target.scopeId,
      },
      denialReason: "no-grant",
    });
  }

  /**
   * An organization connection narrowed to one project stops delivering for
   * every other project's automations: refused with their claims until confirmed.
   */
  async assertNarrowingStrandsNothing({
    connection,
    target,
    force,
  }: {
    connection: SlackConnectionRow;
    target: SlackScope;
    force: boolean;
  }): Promise<void> {
    if (force || connection.scopeType !== "ORGANIZATION") return;
    if (target.scopeType !== "PROJECT") return;
    const claims = await this.deps.claims.findByConnections({
      organizationId: connection.organizationId,
      ids: [connection.id],
      exceptProjectId: target.scopeId,
    });
    if (claims.length > 0) {
      throw new SlackConnectionInUseError({
        dependentAutomations: claims.length,
        claimants: claims.map((claim) => ({ id: claim.claimantId, label: claim.claimantLabel })),
      });
    }
  }

  /** Whether the project may use the connection, reading its organization only if needed. */
  async reaches({
    connection,
    projectId,
  }: {
    connection: SlackConnectionRow;
    projectId: string;
  }): Promise<boolean> {
    if (connection.scopeType === "PROJECT") return connection.scopeId === projectId;
    const [project] = await this.deps.projects.listNamesByIds({ projectIds: [projectId] });
    return (
      project !== undefined &&
      connection.organizationId === project.organizationId &&
      connection.scopeId === project.organizationId
    );
  }
}
