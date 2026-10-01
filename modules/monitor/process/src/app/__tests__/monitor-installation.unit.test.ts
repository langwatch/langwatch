/**
 * @vitest-environment node
 * The installer over memory persistence, in both roles that boot it.
 */
import { type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { evaluatorSchema, type EvaluatorApi } from "@langwatch/evaluator-contract";
import { MonitorApi, type MonitorCreateInput } from "@langwatch/monitor-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
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
  return createApp({ role })
    .withModules([withMemoryRepositories(monitorProcessModule)])
    .withMember("publicBaseUrl", PUBLIC_BASE_URL)
    .provide({
      authz: createApiFixture<AuthzApiContract>({ hasProjectPermission: async () => true }),
      evaluator: createApiFixture<EvaluatorApi>({
        getById: async ({ id, projectId }) => evaluatorRow({ id, projectId }),
      }),
      evaluation: createApiFixture<EvaluationApi>(),
      workflow: createApiFixture<WorkflowApi>(),
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
    const runtime = await process("api").boot();

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
