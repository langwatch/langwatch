/**
 * @vitest-environment node
 * The installer over memory persistence, in both roles that boot it.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { evaluatorSchema, EvaluatorApi } from "@langwatch/evaluator-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { MonitorApi, type MonitorCreateInput } from "@langwatch/monitor-contract";
import { NotificationService } from "@langwatch/notification-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { monitorProcessModule } from "../../monitor.module.ts";

const PUBLIC_BASE_URL = "https://app.langwatch.example";

function evaluatorRow(input: { id: string; projectId: string }) {
  return evaluatorSchema.parse({
    ...input,
    name: "Quality",
    slug: "quality",
    type: "evaluator",
    config: {},
    workflowId: null,
    copiedFromEvaluatorId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function process(role: "api" | "worker") {
  return bootInstalledProcess({
    role,
    modules: [monitorProcessModule],
    config: { monitor: { publicBaseUrl: PUBLIC_BASE_URL } },
    stores: memoryStores(),
    peers: [
      testPeer({
        token: AuthzApi,
        instance: createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
      }),
      testPeer({
        token: EvaluatorApi,
        instance: createApiFixture<EvaluatorApi>({
          getById: async ({ id, projectId }) => evaluatorRow({ id, projectId }),
        }),
      }),
      testPeer({
        token: FeatureFlagApi,
        instance: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      }),
      testPeer({ token: WorkflowApi, instance: createApiFixture<WorkflowApi>() }),
      testPeer({ token: ProjectApi, instance: createApiFixture<ProjectApi>() }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
      testPeer({ token: NotificationService, instance: createApiFixture<NotificationService>() }),
    ],
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
    const runtime = await process(role);

    try {
      const app = runtime.service(MonitorApi);
      const monitor = await app.create({ ...created });

      expect(runtime.module(monitorProcessModule).provided).toBe(app);
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

  /** @scenario "A monitor's platform link is built on the process's public base URL" */
  it("links a monitor on the public base URL the process supplies", async () => {
    const runtime = await process("api");

    try {
      expect(
        runtime
          .service(MonitorApi)
          .platformUrl({ projectSlug: "acme", path: "/online-evaluations" }),
      ).toBe(`${PUBLIC_BASE_URL}/acme/online-evaluations`);
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api");
    const second = await process("api");

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
