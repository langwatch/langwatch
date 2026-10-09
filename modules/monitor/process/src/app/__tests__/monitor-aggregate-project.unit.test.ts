/**
 * @vitest-environment node
 * ADR-175 decision 8: a monitor on an aggregate is refused with the code every other write under
 * an aggregate answers. The REST and tRPC creates both reach the app's create, which asks it.
 */
import type { MonitorCreateInput } from "@langwatch/monitor-contract";
import { AggregateProjectIsReadOnlyError, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import { createMonitorTestApp, createMonitorTestRepositories } from "./monitor.fixture.ts";

const AGGREGATE_ID = "project-aggregate";

const created: MonitorCreateInput = {
  projectId: "project-1",
  name: "Hallucination",
  checkType: "langevals/basic",
  preconditions: [],
  parameters: {},
  mappings: {},
  sample: 1,
  executionMode: "ON_MESSAGE",
  evaluatorId: "evaluator_1",
};

function harness() {
  const assertAcceptsWrites = vi.fn(async ({ projectId }: { projectId: string }) => {
    if (projectId === AGGREGATE_ID) throw new AggregateProjectIsReadOnlyError();
  });
  const repository = MemoryMonitorRepository.create();
  const app = createMonitorTestApp({
    repositories: createMonitorTestRepositories(repository),
    projects: createApiFixture<ProjectApi>({ assertAcceptsWrites }, "ProjectApi"),
  });

  return { app, assertAcceptsWrites };
}

describe("MonitorModule create under an aggregate project", () => {
  describe("when the project is an aggregate", () => {
    it("refuses with the read-only code and creates nothing", async () => {
      const { app } = harness();

      await expect(app.create({ ...created, projectId: AGGREGATE_ID })).rejects.toMatchObject({
        code: "aggregate_project_is_read_only",
      });
      await expect(app.list({ projectId: AGGREGATE_ID })).resolves.toEqual([]);
    });
  });

  describe("when the project is any other kind", () => {
    it("asks the project and lets the monitor through", async () => {
      const { app, assertAcceptsWrites } = harness();

      const monitor = await app.create({ ...created });

      expect(assertAcceptsWrites).toHaveBeenCalledWith({ projectId: "project-1" });
      await expect(app.list({ projectId: "project-1" })).resolves.toMatchObject([
        { id: monitor.id },
      ]);
    });
  });
});
