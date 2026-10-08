/**
 * Instant Evals answers evaluator judges only: every graph save, new workflow, copy and push
 * refuses a node that calls a model on it, before anything is stored. Evaluator nodes keep it.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowDsl } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type {
  WorkflowDslMigration,
  WorkflowExecution,
  WorkflowId,
} from "../../app/workflow.app.ts";
import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { WorkflowRepository } from "../../repositories/workflow.repository.ts";
import type { StudioEventPreparer } from "../studio-event-preparer.service.ts";
import { WorkflowService } from "../workflow.service.ts";
import { TestDatasetService } from "./dataset.service.fake.ts";

const answerNode = (model: string) => ({
  id: "answer",
  type: "signature",
  data: {
    name: "Answer",
    parameters: [{ identifier: "llm", type: "llm", value: { model } }],
  },
});

const judgeNode = {
  id: "judge",
  type: "evaluator",
  data: {
    name: "Judge",
    evaluator: "langevals/llm_boolean",
    parameters: [{ identifier: "model", type: "str", value: INSTANT_EVAL_JUDGE_MODEL_ID }],
  },
};

const graph = (nodes: unknown[]): WorkflowDsl => ({
  version: "1",
  name: "Triage",
  nodes,
  edges: [],
});

const refused = { code: "instant_eval_judge_only_model", httpStatus: 422 };

function build() {
  const repository = MemoryWorkflowRepositories.create().workflows;
  let next = 0;
  const ids: WorkflowId = { next: () => `id_${++next}` };
  const workflows = WorkflowService.create({
    repository,
    datasets: new TestDatasetService().api,
    execution: createApiFixture<WorkflowExecution>({}),
    studioEvents: createApiFixture<StudioEventPreparer>({}),
    dslMigration: createApiFixture<WorkflowDslMigration>({}),
    ids,
  });
  const stored = async () => ({
    workflows: await repository.findAll({ projectId: "project_1" }),
    elsewhere: await repository.findAll({ projectId: "project_2" }),
  });
  return { repository, workflows, stored };
}

/** Rewrites a workflow's stored version in place, as a row written before this rule. */
const storeBeforeTheRule = async ({
  repository,
  workflowId,
}: {
  repository: WorkflowRepository;
  workflowId: string;
}) => {
  const [version] = await repository.findVersions({ workflowId, projectId: "project_1" });
  if (!version) throw new Error("The workflow has no stored version.");
  await repository.updateAutoSavedVersion({
    id: version.id,
    workflowId,
    projectId: "project_1",
    parentId: version.parentId,
    version: version.version,
    autoSaved: version.autoSaved,
    commitMessage: version.commitMessage,
    dsl: graph([answerNode(INSTANT_EVAL_JUDGE_MODEL_ID)]),
  });
};

const seeded = async ({ nodes }: { nodes: unknown[] }) => {
  const built = build();
  const created = await built.workflows.create({
    projectId: "project_1",
    dsl: graph(nodes),
    commitMessage: "first",
  });
  return { ...built, workflowId: created.workflow.id };
};

describe("WorkflowService and Instant Evals", () => {
  describe("given a graph with an LLM node on Instant Evals", () => {
    describe("when it is saved as a version", () => {
      /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
      it("refuses, naming the node, and writes no version", async () => {
        const { workflows, repository, workflowId } = await seeded({
          nodes: [answerNode("openai/gpt-5-mini")],
        });

        await expect(
          workflows.saveVersion({
            projectId: "project_1",
            workflowId,
            dsl: graph([answerNode(INSTANT_EVAL_JUDGE_MODEL_ID)]),
            commitMessage: "broken",
            autoSaved: false,
          }),
        ).rejects.toMatchObject({ ...refused, meta: { places: ['node "Answer"'] } });
        expect(await repository.findVersions({ workflowId, projectId: "project_1" })).toHaveLength(
          1,
        );
      });
    });

    describe("when it starts a new workflow", () => {
      /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
      it("refuses and creates no workflow", async () => {
        const { workflows, stored } = build();

        await expect(
          workflows.create({
            projectId: "project_1",
            dsl: graph([answerNode(INSTANT_EVAL_JUDGE_MODEL_ID)]),
            commitMessage: "first",
          }),
        ).rejects.toMatchObject(refused);
        expect((await stored()).workflows).toEqual([]);
      });
    });
  });

  describe("given a stored workflow whose LLM node is on Instant Evals", () => {
    const brokenSource = async () => {
      const built = await seeded({ nodes: [answerNode("openai/gpt-5-mini")] });
      await storeBeforeTheRule(built);
      return built;
    };

    describe("when it is copied into another project", () => {
      /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
      it("refuses and creates no copy", async () => {
        const { workflows, stored, workflowId } = await brokenSource();

        await expect(
          workflows.copy({
            sourceWorkflowId: workflowId,
            sourceProjectId: "project_1",
            targetProjectId: "project_2",
          }),
        ).rejects.toMatchObject(refused);
        expect((await stored()).elsewhere).toEqual([]);
      });
    });

    describe("when it is pushed to its copies", () => {
      /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
      it("refuses and gives no copy a new version", async () => {
        const { workflows, repository, workflowId } = await seeded({
          nodes: [answerNode("openai/gpt-5-mini")],
        });
        const copied = await workflows.copy({
          sourceWorkflowId: workflowId,
          sourceProjectId: "project_1",
          targetProjectId: "project_1",
        });
        await storeBeforeTheRule({ repository, workflowId });

        await expect(
          workflows.pushToCopies({ workflowId, projectId: "project_1" }),
        ).rejects.toMatchObject(refused);
        expect(
          await repository.findVersions({ workflowId: copied.workflow.id, projectId: "project_1" }),
        ).toHaveLength(1);
      });
    });
  });

  describe("given a graph whose only Instant Evals is an evaluator judge", () => {
    /** @scenario "A workflow whose evaluator node judges on Instant Evals still saves, copies and pushes" */
    it("saves, copies and pushes", async () => {
      const nodes = [judgeNode, answerNode("openai/gpt-5-mini")];
      const { workflows, repository, workflowId } = await seeded({ nodes });

      await workflows.saveVersion({
        projectId: "project_1",
        workflowId,
        dsl: graph(nodes),
        commitMessage: "second",
        autoSaved: false,
      });
      const copied = await workflows.copy({
        sourceWorkflowId: workflowId,
        sourceProjectId: "project_1",
        targetProjectId: "project_1",
      });
      const pushed = await workflows.pushToCopies({ workflowId, projectId: "project_1" });

      expect(pushed.pushedTo).toBe(1);
      expect(
        await repository.findVersions({ workflowId: copied.workflow.id, projectId: "project_1" }),
      ).toHaveLength(2);
    });
  });
});
