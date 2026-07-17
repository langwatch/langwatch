/**
 * @vitest-environment node
 *
 * @see specs/workflows/workflow-node-owned-llm.feature
 *
 * A workflow published BEFORE the node-owned LLM config migration
 * (spec_version 1.4, modelless LLM node, workflow-level default_llm)
 * must keep running through the run API: runWorkflow migrates the
 * persisted DSL on read, so the dispatched payload carries the folded
 * model on the node and no workflow-level default. The nlpgo boundary
 * is mocked to capture the dispatched event; everything up to it
 * (Prisma, migration, addEnvs enrichment) runs for real.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const nlpgoFetchMock = vi.fn();
vi.mock("../../nlpgo/nlpgoFetch", () => ({
  nlpgoFetch: (...args: unknown[]) => nlpgoFetchMock(...args),
}));

import type {
  LLMConfig,
  Workflow,
} from "../../../optimization_studio/types/dsl";
import { prisma } from "../../db";
import { runWorkflow } from "../runWorkflow";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "runWorkflow with a pre-1.5 published version",
  () => {
    const testNamespace = `run-wf-legacy-${nanoid(8)}`;
    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let workflowId: string;
    let userId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: "Test Org", slug: `--test-org-${testNamespace}` },
      });
      organizationId = organization.id;
      const team = await prisma.team.create({
        data: {
          name: "Test Team",
          slug: `--test-team-${testNamespace}`,
          organizationId,
        },
      });
      teamId = team.id;
      const project = await prisma.project.create({
        data: {
          name: "Test Project",
          slug: `--test-project-${testNamespace}`,
          apiKey: `sk-lw-test-${nanoid()}`,
          teamId,
          language: "en",
          framework: "test",
        },
      });
      projectId = project.id;

      const user = await prisma.user.create({
        data: {
          name: "Test User",
          email: `test-${testNamespace}@example.com`,
        },
      });
      userId = user.id;

      // addEnvs enriches the folded model with provider params, so the
      // project needs an enabled provider for it (keys come from env).
      await prisma.modelProvider.create({
        data: {
          name: "OpenAI",
          provider: "openai",
          enabled: true,
          organizationId,
          scopes: { create: [{ scopeType: "PROJECT", scopeId: projectId }] },
        },
      });

      // Persist the exact legacy shape: spec_version 1.4, workflow-level
      // default_llm, signature node whose llm parameter has no value.
      const workflow = await prisma.workflow.create({
        data: {
          id: `workflow_${nanoid()}`,
          projectId,
          name: "Legacy published workflow",
          icon: "🧩",
          description: "",
        },
      });
      workflowId = workflow.id;
      const legacyDsl = {
        spec_version: "1.4",
        workflow_id: workflowId,
        name: "Legacy published workflow",
        icon: "🧩",
        description: "",
        version: "1",
        template_adapter: "default",
        enable_tracing: true,
        default_llm: { model: "openai/gpt-5-mini", max_tokens: 256 },
        state: {},
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry point",
              outputs: [{ identifier: "input", type: "str" }],
              entry_selection: "random",
              train_size: 0.8,
              test_size: 0.2,
              seed: 42,
            },
          },
          {
            id: "llm_call",
            type: "signature",
            position: { x: 300, y: 0 },
            data: {
              name: "LLM Call",
              parameters: [
                { identifier: "llm", type: "llm", value: null },
                {
                  identifier: "instructions",
                  type: "str",
                  value: "You are a helpful assistant.",
                },
              ],
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
          {
            id: "end",
            type: "end",
            position: { x: 600, y: 0 },
            data: {
              name: "End",
              inputs: [{ identifier: "output", type: "str" }],
            },
          },
        ],
        edges: [
          {
            id: "e0",
            source: "entry",
            sourceHandle: "outputs.input",
            target: "llm_call",
            targetHandle: "inputs.input",
            type: "default",
          },
          {
            id: "e1",
            source: "llm_call",
            sourceHandle: "outputs.output",
            target: "end",
            targetHandle: "inputs.output",
            type: "default",
          },
        ],
      };
      const version = await prisma.workflowVersion.create({
        data: {
          id: nanoid(),
          projectId,
          workflowId,
          version: "1",
          commitMessage: "legacy publish",
          authorId: userId,
          autoSaved: false,
          dsl: legacyDsl,
        },
      });
      await prisma.workflow.update({
        where: { id: workflowId, projectId },
        data: {
          currentVersionId: version.id,
          latestVersionId: version.id,
          publishedId: version.id,
        },
      });
    });

    afterAll(async () => {
      await prisma.workflow.updateMany({
        where: { projectId },
        data: {
          currentVersionId: null,
          latestVersionId: null,
          publishedId: null,
        },
      });
      await prisma.workflowVersion.deleteMany({ where: { projectId } });
      await prisma.workflow.deleteMany({ where: { projectId } });
      await prisma.modelProvider.deleteMany({ where: { organizationId } });
      await prisma.project.delete({ where: { id: projectId } });
      await prisma.team.delete({ where: { id: teamId } });
      await prisma.organization.delete({ where: { id: organizationId } });
      await prisma.user.delete({ where: { id: userId } });
    });

    /** @scenario Published workflows saved before the change still run with their old model */
    it("dispatches the folded model on the node and no workflow-level default", async () => {
      nlpgoFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: {}, status: "success" }),
      });

      await runWorkflow(workflowId, projectId, { input: "hello" });

      expect(nlpgoFetchMock).toHaveBeenCalledTimes(1);
      const dispatched = nlpgoFetchMock.mock.calls[0]![0] as {
        body: { payload: { workflow: Workflow } };
      };
      const workflow = dispatched.body.payload.workflow;

      const signature = workflow.nodes.find((n) => n.type === "signature");
      const llmValue = signature?.data.parameters?.find(
        (p) => p.type === "llm",
      )?.value as LLMConfig;
      expect(llmValue.model).toBe("openai/gpt-5-mini");
      expect(llmValue.max_tokens).toBe(256);
      expect("default_llm" in workflow).toBe(false);
    });
  },
);
