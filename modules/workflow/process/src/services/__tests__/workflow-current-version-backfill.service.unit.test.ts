/**
 * The deploy backfill pages live workflows by project and records each current version once.
 * Spec: modules/workflow/specs/workflow-service.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowRepository } from "../../repositories/workflow.repository.ts";
import { WorkflowCurrentVersionBackfillService } from "../workflow-current-version-backfill.service.ts";

type Versions = Parameters<typeof WorkflowCurrentVersionBackfillService.create>[0]["versions"];

function setup() {
  const live: Record<string, string[]> = {
    project_2: ["workflow_3"],
    project_1: ["workflow_1", "workflow_2"],
  };
  const workflows = createApiFixture<Pick<WorkflowRepository, "findProjectIds" | "findAll">>({
    findProjectIds: async () => Object.keys(live),
    findAll: async ({ projectId }) =>
      (live[projectId] ?? []).map((id) => ({ id, projectId }) as never),
  });
  const recordCurrentVersionFields = vi.fn<Versions["recordCurrentVersionFields"]>(
    async ({ workflowId }) => workflowId !== "workflow_2",
  );
  const backfill = WorkflowCurrentVersionBackfillService.create({
    workflows,
    versions: createApiFixture<Versions>({ recordCurrentVersionFields }),
  });
  return { backfill, recordCurrentVersionFields, signal: new AbortController().signal };
}

describe("WorkflowCurrentVersionBackfillService", () => {
  /** @scenario "The deploy backfill records each live workflow's current version with its fields" */
  it("records every live workflow in project order, checkpointing each project", async () => {
    const { backfill, recordCurrentVersionFields, signal } = setup();
    const done: string[] = [];

    const report = await backfill.recordLiveWorkflows({
      dryRun: false,
      signal,
      afterTenantId: null,
      onTenantDone: async ({ tenantId }) => void done.push(tenantId),
    });

    expect(report).toEqual({ tenants: 2, liveWorkflows: 3, versionsRecorded: 2 });
    expect(recordCurrentVersionFields.mock.calls.map(([input]) => input.workflowId)).toEqual([
      "workflow_1",
      "workflow_2",
      "workflow_3",
    ]);
    expect(done).toEqual(["project_1", "project_2"]);
  });

  /** @scenario "The deploy backfill records each live workflow's current version with its fields" */
  it("records nothing on a dry run, and a resumed run skips the finished projects", async () => {
    const { backfill, recordCurrentVersionFields, signal } = setup();
    const onTenantDone = vi.fn(async () => void 0);

    const dry = await backfill.recordLiveWorkflows({
      dryRun: true,
      signal,
      afterTenantId: null,
      onTenantDone,
    });
    expect(dry).toEqual({ tenants: 2, liveWorkflows: 3, versionsRecorded: 0 });
    expect(recordCurrentVersionFields).not.toHaveBeenCalled();
    expect(onTenantDone).not.toHaveBeenCalled();

    const resumed = await backfill.recordLiveWorkflows({
      dryRun: false,
      signal,
      afterTenantId: "project_1",
      onTenantDone,
    });
    expect(resumed).toEqual({ tenants: 1, liveWorkflows: 1, versionsRecorded: 1 });
    expect(onTenantDone).toHaveBeenCalledTimes(1);
  });
});
