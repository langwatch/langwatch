import type { AuthzPermission } from "@langwatch/authorization";
import type { AuthzApi, AuthzPrincipalRef } from "@langwatch/authz-contract";

import type { WorkflowPermissionProbe } from "../app/workflow.app.ts";

/** Whether one person holds a permission on a project, answered by the authz peer. */
export class WorkflowPermissionService implements WorkflowPermissionProbe {
  static create(options: {
    authz: Pick<AuthzApi, "hasPermission" | "can">;
  }): WorkflowPermissionService {
    return new WorkflowPermissionService(options.authz);
  }

  readonly #authz: Pick<AuthzApi, "hasPermission" | "can">;

  private constructor(authz: Pick<AuthzApi, "hasPermission" | "can">) {
    this.#authz = authz;
  }

  has(input: { userId: string; projectId: string; permission: AuthzPermission }): Promise<boolean> {
    return this.#authz.hasPermission({
      userId: input.userId,
      permission: input.permission,
      projectId: input.projectId,
    });
  }

  /** One permission asked of a credential's principal at the project scope. */
  holds(input: {
    principal: AuthzPrincipalRef;
    project: Readonly<{ id: string; teamId: string; organizationId: string }>;
    permission: AuthzPermission;
  }): Promise<boolean> {
    return this.#authz.can({
      principal: input.principal,
      permission: input.permission,
      scope: {
        type: "project",
        id: input.project.id,
        teamId: input.project.teamId,
        organizationId: input.project.organizationId,
      },
    });
  }

  /** One project at a time, so a workflow with many copies never floods the connection pool. */
  async hasMany(input: {
    userId: string;
    projectIds: readonly string[];
    permission: AuthzPermission;
  }): Promise<ReadonlyMap<string, boolean>> {
    const answers = new Map<string, boolean>();
    for (const projectId of input.projectIds) {
      answers.set(
        projectId,
        await this.has({ userId: input.userId, projectId, permission: input.permission }),
      );
    }

    return answers;
  }
}
