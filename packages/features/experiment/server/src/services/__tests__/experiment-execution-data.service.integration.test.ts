/**
 * Integration tests for loadExecutionData against the real database.
 *
 * Regression coverage for: a workflow built in Optimization Studio and saved
 * as an agent (agent.type === "workflow") has no code of its own — it only
 * points at a Studio workflow. loadExecutionData must resolve that linked
 * workflow's published DSL so the orchestrator can run it as a whole
 * workflow, instead of falling through to the code-execution path with no
 * source at all.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 * @see specs/experiments-v3/evaluation-execution.feature
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the suite
 * stays runnable on a box with no database.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import type { AgentService, AgentWithFields } from "@langwatch/agent-contract";
import { AgentNotFoundError } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { Evaluator, EvaluatorService } from "@langwatch/evaluator-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import { PostgresPromptAdapter } from "@langwatch/prompt-server";
import type { ExperimentWorkflowDslPort } from "../../ports/experiment-workflow-dsl.port";
import { loadExecutionData, promptLoadKey, workflowLoadKey } from "../experiment-execution-data.service";

/**
 * This suite writes and reads the rows itself and does not exercise
 * multi-tenant guard behaviour, so it composes the client without a guard
 * rather than teaching one about rows created ad hoc per test.
 */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** In-memory `AgentService` — only `getById`/`create` are exercised here. */
class FakeAgentService implements Pick<AgentService, "getById" | "create"> {
  private readonly byId = new Map<string, AgentWithFields>();

  async create(input: {
    id?: string;
    projectId: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    workflowId?: string;
  }): Promise<AgentWithFields> {
    const agent = {
      id: input.id ?? `test_agent_${nanoid(8)}`,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      config: input.config,
      workflowId: input.workflowId ?? null,
      copiedFromAgentId: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      inputFields: [],
      outputFields: [],
      fieldsResolved: true,
    } as unknown as AgentWithFields;
    this.byId.set(agent.id, agent);
    return agent;
  }

  async getById(input: { id: string; projectId: string }): Promise<AgentWithFields> {
    const agent = this.byId.get(input.id);
    if (!agent || agent.projectId !== input.projectId) {
      throw new AgentNotFoundError(input.id, input.projectId);
    }
    return agent;
  }
}

/** `EvaluatorService` that never finds anything — this suite only exercises the miss path. */
class FakeEvaluatorService implements Pick<EvaluatorService, "tryGetById"> {
  async tryGetById(_input: { id: string; projectId: string }): Promise<Evaluator | null> {
    return null;
  }
}

/** Real-Postgres-backed `ExperimentWorkflowDslPort`, scoped to this suite's own rows. */
function createWorkflowDslPort(prisma: PrismaClient): ExperimentWorkflowDslPort {
  return {
    async tryFindWorkflow(input) {
      const workflow = await prisma.workflow.findFirst({
        where: { id: input.workflowId, projectId: input.projectId },
      });
      if (!workflow) return null;
      return { id: workflow.id, name: workflow.name, publishedId: workflow.publishedId };
    },
    async tryFindVersionDsl(input) {
      const version = await prisma.workflowVersion.findFirst({
        where: { id: input.versionId, workflowId: input.workflowId, projectId: input.projectId },
      });
      return version?.dsl ?? null;
    },
    async tryFindEvaluableWorkflow() {
      throw new Error("not implemented — unused by this suite");
    },
    async tryFindEvaluableVersion() {
      throw new Error("not implemented — unused by this suite");
    },
  } satisfies ExperimentWorkflowDslPort as ExperimentWorkflowDslPort;
}

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PROJECT_ID = `proj_dataloader_${nanoid(8)}`;
const TEAM_ID = `team_dataloader_${nanoid(8)}`;
const ORG_ID = `org_dataloader_${nanoid(8)}`;

describe.skipIf(!DB_URL)("loadExecutionData", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;
  let authorId: string;

  const cleanupAgentIds: string[] = [];
  const cleanupWorkflowIds: string[] = [];
  const cleanupPromptIds: string[] = [];

  beforeAll(async () => {
    connection = PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
    );
    prisma = connection.client as PrismaClient;

    await prisma.organization.create({
      data: { id: ORG_ID, name: "Test Organization", slug: ORG_ID },
    });
    await prisma.team.create({
      data: { id: TEAM_ID, name: "Test Team", slug: TEAM_ID, organizationId: ORG_ID },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: "Test Project",
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${PROJECT_ID}`,
      },
    });
    const user = await prisma.user.create({
      data: { id: `user_dataloader_${nanoid(8)}`, email: `${PROJECT_ID}@example.com` },
    });
    authorId = user.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanupTestRows(prisma, [
      ["agent", { id: { in: cleanupAgentIds }, projectId: PROJECT_ID }],
      ["workflowVersion", { workflowId: { in: cleanupWorkflowIds }, projectId: PROJECT_ID }],
      ["workflow", { id: { in: cleanupWorkflowIds }, projectId: PROJECT_ID }],
      [
        "llmPromptConfigVersion",
        { configId: { in: cleanupPromptIds }, projectId: PROJECT_ID },
      ],
      ["llmPromptConfig", { id: { in: cleanupPromptIds }, projectId: PROJECT_ID }],
      ["user", { id: authorId }],
      ["project", { id: PROJECT_ID }],
      ["team", { id: TEAM_ID }],
      ["organization", { id: ORG_ID }],
    ]);
    await prisma.$disconnect();
  });

  const createPromptService = (): PromptService =>
    PostgresPromptAdapter.create({ database: prisma! }).build();

  const services = () => ({
    datasets: {} as DatasetService,
    prompts: createPromptService(),
    agents: new FakeAgentService() as unknown as AgentService,
    workflows: createWorkflowDslPort(prisma!),
    evaluators: new FakeEvaluatorService() as unknown as EvaluatorService,
  });

  const createPublishedWorkflow = async (name: string) => {
    const workflowId = `test_wf_${nanoid(8)}`;
    await prisma!.workflow.create({
      data: {
        id: workflowId,
        projectId: PROJECT_ID,
        name,
        icon: "🤖",
        description: "Test workflow",
      },
    });
    cleanupWorkflowIds.push(workflowId);

    const version = await prisma!.workflowVersion.create({
      data: {
        id: `test_wfv_${nanoid(8)}`,
        workflowId,
        projectId: PROJECT_ID,
        version: "1",
        commitMessage: "initial",
        authorId,
        dsl: {
          nodes: [
            { id: "entry", type: "entry", data: {} },
            { id: "llm", type: "signature", data: {} },
            { id: "end", type: "end", data: {} },
          ],
          edges: [],
        },
      },
    });

    await prisma!.workflow.update({
      where: { id: workflowId },
      data: { publishedId: version.id },
    });

    return { workflowId, versionId: version.id };
  };

  describe("given an agent target that wraps a Studio workflow", () => {
    it("resolves the linked workflow's published DSL", async () => {
      const { workflowId, versionId } = await createPublishedWorkflow(
        "fast resolution agent workflow",
      );

      const agentService = new FakeAgentService();
      const agent = await agentService.create({
        id: `test_agent_${nanoid(8)}`,
        projectId: PROJECT_ID,
        name: "fast resolution agent",
        type: "workflow",
        config: { name: "Custom", workflow_id: workflowId },
        workflowId,
      });
      cleanupAgentIds.push(agent.id);

      const result = await loadExecutionData(
        PROJECT_ID,
        {
          type: "inline",
          columns: [],
          inline: { columns: [], records: {} },
        },
        [{ type: "agent", dbAgentId: agent.id }],
        [],
        { ...services(), agents: agentService as unknown as AgentService },
      );

      if ("error" in result) {
        throw new Error(`loadExecutionData failed: ${result.error}`);
      }

      const loadedWorkflow = result.loadedWorkflows.get(
        workflowLoadKey({ workflowId }),
      );
      expect(loadedWorkflow).toBeDefined();
      expect(loadedWorkflow?.id).toBe(workflowId);
      expect(loadedWorkflow?.versionId).toBe(versionId);
      expect(loadedWorkflow?.dsl.nodes).toHaveLength(3);

      // The agent itself is still loaded too (name/type used for display and
      // for the orchestrator to detect agent.type === "workflow").
      const loadedAgent = result.loadedAgents.get(agent.id);
      expect(loadedAgent?.type).toBe("workflow");
    });

    it("errors clearly when the linked workflow has no published version", async () => {
      const workflowId = `test_wf_${nanoid(8)}`;
      await prisma!.workflow.create({
        data: {
          id: workflowId,
          projectId: PROJECT_ID,
          name: "unpublished workflow",
          icon: "🤖",
          description: "Test workflow with no published version",
        },
      });
      cleanupWorkflowIds.push(workflowId);

      const agentService = new FakeAgentService();
      const agent = await agentService.create({
        id: `test_agent_${nanoid(8)}`,
        projectId: PROJECT_ID,
        name: "unpublished workflow agent",
        type: "workflow",
        config: { name: "Custom", workflow_id: workflowId },
        workflowId,
      });
      cleanupAgentIds.push(agent.id);

      const result = await loadExecutionData(
        PROJECT_ID,
        {
          type: "inline",
          columns: [],
          inline: { columns: [], records: {} },
        },
        [{ type: "agent", dbAgentId: agent.id }],
        [],
        { ...services(), agents: agentService as unknown as AgentService },
      );

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("no committed version");
      }
    });
  });

  describe("given a target naming an agent this project does not have", () => {
    describe("when the execution data is loaded", () => {
      /** @scenario A run stops when a target's agent was deleted */
      it("fails and names the missing agent", async () => {
        const missingAgentId = `test_agent_${nanoid(8)}`;

        const result = await loadExecutionData(
          PROJECT_ID,
          {
            type: "inline",
            columns: [],
            inline: { columns: [], records: {} },
          },
          [{ type: "agent", dbAgentId: missingAgentId }],
          [],
          services(),
        );

        expect("error" in result).toBe(true);
        if ("error" in result) {
          expect(result.error).toBe(`Agent "${missingAgentId}" not found`);
          expect(result.status).toBe(404);
        }
      });
    });
  });

  describe("given two targets pinned to different versions of one prompt", () => {
    describe("when the execution data is loaded", () => {
      /** @scenario "Two columns pinned to different versions of one prompt each run their own version" */
      it("loads both versions instead of letting the last one win", async () => {
        const promptService = createPromptService();
        const created = await promptService.createPrompt({
          projectId: PROJECT_ID,
          organizationId: ORG_ID,
          handle: `two-versions-${nanoid(8)}`,
          prompt: "version one",
          model: "openai/gpt-5-mini",
        });
        cleanupPromptIds.push(created.id);

        const second = await promptService.updatePrompt({
          idOrHandle: created.id,
          projectId: PROJECT_ID,
          data: { commitMessage: "second", prompt: "version two" },
        });
        expect(second.version).toBe(2);

        const result = await loadExecutionData(
          PROJECT_ID,
          {
            type: "inline",
            columns: [],
            inline: { columns: [], records: {} },
          },
          [
            { type: "prompt", promptId: created.id, promptVersionNumber: 1 },
            { type: "prompt", promptId: created.id, promptVersionNumber: 2 },
          ],
          [],
          { ...services(), prompts: promptService },
        );

        if ("error" in result) {
          throw new Error(`loadExecutionData failed: ${result.error}`);
        }

        const first = result.loadedPrompts.get(
          promptLoadKey({ promptId: created.id, promptVersionNumber: 1 }),
        );
        const latest = result.loadedPrompts.get(
          promptLoadKey({ promptId: created.id, promptVersionNumber: 2 }),
        );

        expect(first?.version).toBe(1);
        expect(first?.prompt).toBe("version one");
        expect(latest?.version).toBe(2);
        expect(latest?.prompt).toBe("version two");
      });
    });
  });

  describe("given an evaluator config naming an evaluator this project does not have", () => {
    describe("when the execution data is loaded", () => {
      /** @scenario A run stops when an evaluator was deleted */
      it("fails and names the missing evaluator", async () => {
        const missingEvaluatorId = `test_eval_${nanoid(8)}`;

        const result = await loadExecutionData(
          PROJECT_ID,
          {
            type: "inline",
            columns: [],
            inline: { columns: [], records: {} },
          },
          [],
          [{ dbEvaluatorId: missingEvaluatorId }],
          services(),
        );

        expect("error" in result).toBe(true);
        if ("error" in result) {
          expect(result.error).toBe(
            `Evaluator "${missingEvaluatorId}" not found`,
          );
          expect(result.status).toBe(404);
        }
      });
    });
  });
});
