import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { getTestUser } from "~/utils/testUtils";
import { prisma } from "~/server/db";
import { saveOrCommitWorkflowVersion } from "../workflows";
import type { Session } from "~/server/auth";

/**
 * Integration test for saveOrCommitWorkflowVersion.
 *
 * Verifies that localPromptConfig is merged into parameters before
 * persisting — the root cause of #3437 where workflow evaluators
 * used a stale prompt when triggered from trace monitors.
 */
describe("saveOrCommitWorkflowVersion", () => {
  const workflowId = `test_workflow_${nanoid(8)}`;
  let projectId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await getTestUser();
    projectId = "test-project-id";
    userId = user.id;

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
    await prisma.workflow
      .update({
        where: { id: workflowId, projectId },
        data: { latestVersionId: null, currentVersionId: null },
      })
      .catch(() => {});
    await prisma.workflowVersion
      .deleteMany({ where: { workflowId, projectId } })
      .catch(() => {});
    await prisma.workflow
      .delete({ where: { id: workflowId, projectId } })
      .catch(() => {});
  });

  const getCtx = () => ({
    prisma,
    session: { user: { id: userId } } as Session,
  });

  describe("when a signature node has localPromptConfig", () => {
    it("merges localPromptConfig into parameters in the persisted DSL", async () => {
      const dsl = buildDsl({
        instructions: "You are a helpful assistant.",
        messages: [{ role: "user", content: "{{input}}" }],
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
        ctx: getCtx(),
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

      // mergeLocalConfigsIntoDsl splits the system message into instructions
      // and keeps only non-system messages in the messages parameter
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

  describe("when nodes have execution_state", () => {
    it("strips execution_state from persisted nodes", async () => {
      const dsl = buildDsl({
        instructions: "You are a helpful assistant.",
        messages: [{ role: "user", content: "{{input}}" }],
        executionState: {
          status: "success",
          trace_id: "trace_123",
          span_id: "span_456",
          timestamps: { started_at: 1000, finished_at: 2000 },
        },
      });

      const version = await saveOrCommitWorkflowVersion({
        ctx: getCtx(),
        input: { projectId, workflowId, dsl },
        autoSaved: false,
        commitMessage: "test execution_state stripping",
      });

      const savedDsl = version.dsl as any;
      for (const node of savedDsl.nodes) {
        expect(node.data.execution_state).toBeUndefined();
      }
    });
  });

  describe("when a signature node has NO localPromptConfig", () => {
    it("preserves parameters as-is", async () => {
      const dsl = buildDsl({
        instructions: "You are a bias evaluator.",
        messages: [{ role: "user", content: "Evaluate: {{output}}" }],
      });

      const version = await saveOrCommitWorkflowVersion({
        ctx: getCtx(),
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

let versionCounter = 0;

function buildDsl({
  instructions,
  messages,
  localPromptConfig,
  executionState,
}: {
  instructions: string;
  messages: Array<{ role: string; content: string }>;
  localPromptConfig?: any;
  executionState?: any;
}) {
  versionCounter++;
  return {
    workflow_id: "test",
    spec_version: "1.3",
    name: "Test Workflow",
    icon: "🧪",
    description: "test",
    version: `${versionCounter}`,
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
            { identifier: "instructions", type: "str", value: instructions },
            {
              identifier: "messages",
              type: "chat_messages",
              value: messages,
            },
          ],
          localPromptConfig,
          execution_state: executionState,
        },
      },
    ],
    edges: [],
    state: {},
  } as any;
}
