/**
 * @vitest-environment node
 * The installer over memory persistence, in both roles that boot it.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import { MonitorApi, type MonitorCreateInput } from "@langwatch/monitor-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { monitorServer } from "../../monitor.server.ts";
import {
  FakeMonitorEvaluators,
  FakeMonitorPerformance,
  FakeMonitorReplication,
} from "./monitor.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role, config: {} })
    .withProvided(
      AuthzApi,
      createApiFixture<AuthzApiContract>({ hasProjectPermission: async () => true }),
    )
    .withModule(monitorServer, {
      members: {
        evaluators: new FakeMonitorEvaluators(),
        performance: new FakeMonitorPerformance(),
        replication: new FakeMonitorReplication({ id: "evaluator_copy", workflowId: null }),
        generateId: () => `monitor_${Math.random().toString(36).slice(2, 10)}`,
      },
    });
}

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

describe("monitor app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(MonitorApi);
      const monitor = await app.create({ ...created });

      expect(runtime.module(monitorServer).provided).toBe(app);
      await expect(app.list({ projectId: "project-1" })).resolves.toMatchObject([
        { id: monitor.id },
      ]);
      await expect(app.getById({ id: monitor.id, projectId: "project-1" })).resolves.toMatchObject({
        name: "Hallucination",
      });
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

    try {
      await first.service(MonitorApi).create({ ...created });

      await expect(
        second.service(MonitorApi).list({ projectId: "project-1" }),
      ).resolves.toHaveLength(0);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });
});
