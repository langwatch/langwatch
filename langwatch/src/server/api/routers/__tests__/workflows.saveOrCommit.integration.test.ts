import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import type { Session } from "~/server/auth";
import { prisma } from "~/server/db";
import { saveOrCommitWorkflowVersion } from "../workflows";

/**
 * Integration test for saveOrCommitWorkflowVersion.
 *
 * Verifies that localPromptConfig is merged into parameters before
 * persisting — the root cause of #3437 where workflow evaluators
 * used a stale prompt when triggered from trace monitors.
 */
describe("saveOrCommitWorkflowVersion", () => {
  const projectId = `test_project_${nanoid(8)}`;
  const userId = `test_user_${nanoid(8)}`;
  const teamId = `test_team_${nanoid(8)}`;
  const workflowId = `test_workflow_${nanoid(8)}`;

  const ctx = {
    prisma: prisma as PrismaClient,
    session: { user: { id: userId } } as Session,
  };

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.com`, name: "Test User" },
    });
    const team = await prisma.team.create({
      data: {
        id: teamId,
        slug: `test-team-${nanoid(6)}`,
        name: "Test Team",
        organizationId: `test_org_${nanoid(8)}`,
        members: { create: { userId, role: "ADMIN" } },
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "Test Project",
        slug: `test-${nanoid(6)}`,
        teamId: team.id,
        language: "en",
        framework: "custom",
        apiKey: `sk-test-${nanoid(12)}`,
      },
    });
    await prisma.workflow.create({
      data: {
        id: workflowId,
        projectId,
        name: "Test Workflow",
        icon: "🧪",
        description: "test",
      },
    });
  });

  afterAll(async () => {
    await prisma.workflowVersion.deleteMany({ where: { projectId } });
    await prisma.workflow.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("when a signature node has localPromptConfig", () => {
    it("merges localPromptConfig into parameters in the persisted DSL", async () => {
      const dsl = buildDslWithLocalPromptConfig({
        oldInstructions: "You are a helpful assistant.",
        oldMessages: [{ role: "user", content: "{{input}}" }],
        localPromptConfig: {
          llm: { model: "openai/gpt-5-mini", temperature: 0.5 },
          messages: [
            {
              role: "system",
              content:
                "You are a strict boolean evaluator.\n\nCheck if classifier_output matches fetch_report_code_input.\n\n- fetch_report_code_input: {{fetch_report_code_input}}\n- classifier_output: {{classifier_output}}",
            },
            { role: "user", content: "{{input}}" },
          ],
          inputs: [
            { identifier: "input", type: "str" },
            { identifier: "classifier_output", type: "str" },
            { identifier: "fetch_report_code_input", type: "str" },
          ],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "reason", type: "str" },
          ],
        },
      });

      const version = await saveOrCommitWorkflowVersion({
        ctx,
        input: { projectId, workflowId, dsl },
        autoSaved: false,
        commitMessage: "test localPromptConfig merge",
      });

      const savedDsl = version.dsl as any;
      const signatureNode = savedDsl.nodes.find(
        (n: any) => n.type === "signature",
      );
      expect(signatureNode).toBeDefined();

      const params = signatureNode.data.parameters;
      const instructions = params.find(
        (p: any) => p.identifier === "instructions",
      );
      const messages = params.find((p: any) => p.identifier === "messages");

      // The NEW prompt must be in parameters, not the old one
      expect(instructions?.value).toContain("strict boolean evaluator");
      expect(instructions?.value).not.toContain("helpful assistant");

      // Messages must reference the evaluation inputs
      expect(messages?.value).toEqual([
        { role: "user", content: "{{input}}" },
      ]);

      // localPromptConfig must be stripped
      expect(signatureNode.data.localPromptConfig).toBeUndefined();

      // Inputs/outputs must reflect the local config
      expect(signatureNode.data.inputs).toEqual([
        { identifier: "input", type: "str" },
        { identifier: "classifier_output", type: "str" },
        { identifier: "fetch_report_code_input", type: "str" },
      ]);
    });
  });

  describe("when a signature node has NO localPromptConfig", () => {
    it("preserves parameters as-is", async () => {
      const dsl = buildDslWithoutLocalPromptConfig({
        instructions: "You are a bias evaluator.",
        messages: [{ role: "user", content: "Evaluate: {{output}}" }],
      });

      const version = await saveOrCommitWorkflowVersion({
        ctx,
        input: { projectId, workflowId, dsl },
        autoSaved: false,
        commitMessage: "test no localPromptConfig",
      });

      const savedDsl = version.dsl as any;
      const signatureNode = savedDsl.nodes.find(
        (n: any) => n.type === "signature",
      );
      const instructions = signatureNode.data.parameters.find(
        (p: any) => p.identifier === "instructions",
      );

      expect(instructions?.value).toBe("You are a bias evaluator.");
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDslWithLocalPromptConfig({
  oldInstructions,
  oldMessages,
  localPromptConfig,
}: {
  oldInstructions: string;
  oldMessages: Array<{ role: string; content: string }>;
  localPromptConfig: any;
}) {
  return {
    workflow_id: "test",
    spec_version: "1.3",
    name: "Test Workflow",
    icon: "🧪",
    description: "test",
    version: "1",
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        data: {
          name: "Entry",
          outputs: [{ identifier: "input", type: "str" }],
        },
      },
      {
        id: "llm_call",
        type: "signature",
        position: { x: 200, y: 0 },
        data: {
          name: "Prompt",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          parameters: [
            {
              identifier: "llm",
              type: "llm",
              value: { model: "openai/gpt-5-mini" },
            },
            {
              identifier: "instructions",
              type: "str",
              value: oldInstructions,
            },
            {
              identifier: "messages",
              type: "chat_messages",
              value: oldMessages,
            },
          ],
          localPromptConfig,
        },
      },
    ],
    edges: [],
    state: {},
  } as any;
}

function buildDslWithoutLocalPromptConfig({
  instructions,
  messages,
}: {
  instructions: string;
  messages: Array<{ role: string; content: string }>;
}) {
  return buildDslWithLocalPromptConfig({
    oldInstructions: instructions,
    oldMessages: messages,
    localPromptConfig: undefined,
  });
}
