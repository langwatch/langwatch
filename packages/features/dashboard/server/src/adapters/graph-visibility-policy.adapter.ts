import { DashboardGraphVisibilityPolicyPort } from "../ports/dashboard.port";
import type { WorkbenchAccessPort } from "../ports/workbench-access.port";

/** Preserves the project-level LangWatchQL gate when Dashboard counts visible cards. */
export class WorkbenchAwareGraphVisibilityAdapter extends DashboardGraphVisibilityPolicyPort {
  private constructor(private readonly workbenchAccess: WorkbenchAccessPort) {
    super();
  }

  static create(dependencies: {
    workbenchAccess: WorkbenchAccessPort;
  }): WorkbenchAwareGraphVisibilityAdapter {
    return new WorkbenchAwareGraphVisibilityAdapter(dependencies.workbenchAccess);
  }

  async placeableKinds(input: {
    projectId: string;
  }): Promise<readonly ("builder" | "workbench_sql")[]> {
    const enabled = await this.workbenchAccess.isWorkbenchEnabled({
      projectId: input.projectId,
    });
    return enabled ? ["builder", "workbench_sql"] : ["builder"];
  }
}
