import type { AuthzApi, AuthzPermission } from "@langwatch/authz-contract";

import type { WorkflowPermissionProbe } from "../app/workflow.app.ts";

/** Whether one person holds a permission on a project, answered by the authz peer. */
export class WorkflowPermissionService implements WorkflowPermissionProbe {
  static create(options: { authz: Pick<AuthzApi, "hasPermission"> }): WorkflowPermissionService {
    return new WorkflowPermissionService(options.authz);
  }

  readonly #authz: Pick<AuthzApi, "hasPermission">;

  private constructor(authz: Pick<AuthzApi, "hasPermission">) {
    this.#authz = authz;
  }

  has(input: { userId: string; projectId: string; permission: AuthzPermission }): Promise<boolean> {
    return this.#authz.hasPermission({
      userId: input.userId,
      permission: input.permission,
      projectId: input.projectId,
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
