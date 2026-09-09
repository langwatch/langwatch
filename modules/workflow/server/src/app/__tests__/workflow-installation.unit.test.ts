/**
 * The workflow module installs, in every role it serves, and the token the
 * transports bind to resolves to the app the installer built.
 */
import { createApp } from "@langwatch/runtime-composition";
import { WorkflowApi, type Workflow } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { workflowServer } from "../../workflow.server.ts";
import { createWorkflowTestInfrastructure, createWorkflowTestService } from "./workflow.fixture.ts";

const NOW = new Date("2026-09-09T00:00:00.000Z");

const workflow = {
  id: "workflow_1",
  projectId: "project-1",
  name: "A workflow",
  icon: null,
  description: null,
  latestVersionId: null,
  currentVersionId: null,
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: false,
  isComponent: false,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies Workflow;

function process_() {
  return createApp({ name: "workflow-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure(
      createWorkflowTestInfrastructure({ workflows: createWorkflowTestService([workflow]) }),
    )
    .withModule(workflowServer);
}

describe("workflow app installation", () => {
  describe("given a process that supplies the module's infrastructure", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process_().boot({ role });

      try {
        const app = runtime.service(WorkflowApi);

        expect(runtime.module(workflowServer).provided).toBe(app);
        await expect(app.list({ projectId: "project-1" })).resolves.toEqual([workflow]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
