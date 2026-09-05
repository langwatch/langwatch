import { describe, expect, it } from "vitest";
import { WorkbenchAccessPort } from "../../ports/workbench-access.port";
import { WorkbenchAwareGraphVisibilityAdapter } from "../graph-visibility-policy.adapter";

class FixedWorkbenchAccess extends WorkbenchAccessPort {
  constructor(private readonly enabled: boolean) {
    super();
  }

  async isWorkbenchEnabled(): Promise<boolean> {
    return this.enabled;
  }
}

describe("WorkbenchAwareGraphVisibilityAdapter", () => {
  it("offers the workbench kind only while the project may place one", async () => {
    const permitted = WorkbenchAwareGraphVisibilityAdapter.create({
      workbenchAccess: new FixedWorkbenchAccess(true),
    });
    const refused = WorkbenchAwareGraphVisibilityAdapter.create({
      workbenchAccess: new FixedWorkbenchAccess(false),
    });

    await expect(permitted.placeableKinds({ projectId: "project_1" })).resolves.toEqual([
      "builder",
      "workbench_sql",
    ]);
    await expect(refused.placeableKinds({ projectId: "project_1" })).resolves.toEqual(["builder"]);
  });
});
