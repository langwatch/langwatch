/**
 * Whether everything a workbench state points at still exists.
 *
 * A workbench names prompts, agents, evaluators, workflows and datasets by id.
 * Saving one whose references have been deleted stores a configuration that
 * cannot run, and the customer finds out when they press the button — several
 * saves after the edit that broke it. So the save is refused, naming the type
 * and the id that is missing.
 *
 * The distinction that carries the most weight is DOWN versus GONE. Two of the
 * five features answer by throwing, so their not-found errors become `false`
 * and everything else is rethrown. An evaluator service that is unreachable
 * must not read as an evaluator that was deleted: one is a retry, the other
 * tells the customer to fix their workbench.
 */

import { describe, expect, it } from "vitest";
import { AgentService } from "@langwatch/agent-contract";
import { DatasetService } from "@langwatch/dataset-contract";
import { EvaluatorNotFoundError, EvaluatorService } from "@langwatch/evaluator-contract";
import { PromptService } from "@langwatch/prompt-contract";
import { WorkflowNotFoundError, WorkflowService } from "@langwatch/workflow-contract";
import {
  persistedEvaluationsV3StateSchema,
  WorkbenchMissingReferenceError,
  type PersistedEvaluationsV3State,
} from "@langwatch/experiment-contract";
import { ExperimentWorkbenchReferencesService } from "../experiment-workbench-references.service";

type Answers = {
  prompts?: Array<{ id: string; handle?: string | null }>;
  agentExists?: boolean;
  datasetIds?: string[];
  evaluator?: "found" | "missing" | "down";
  workflow?: "found" | "missing" | "down";
};

function servicesAnswering(answers: Answers = {}) {
  const prompts: PromptService = Object.create(PromptService.prototype);
  prompts.getAllPrompts = async () => (answers.prompts ?? []) as never;

  const agents: AgentService = Object.create(AgentService.prototype);
  agents.exists = async () => answers.agentExists ?? false;

  const dataset: DatasetService = Object.create(DatasetService.prototype);
  dataset.getByIds = async ({ datasetIds }: { datasetIds: string[] }) =>
    datasetIds
      .filter((id) => (answers.datasetIds ?? []).includes(id))
      .map((id) => ({ id })) as never;

  const evaluators: EvaluatorService = Object.create(EvaluatorService.prototype);
  evaluators.getById = async () => {
    if (answers.evaluator === "found") return {} as never;
    if (answers.evaluator === "down") throw new Error("evaluator service unreachable");
    throw new EvaluatorNotFoundError("evaluator_missing");
  };

  const workflows: WorkflowService = Object.create(WorkflowService.prototype);
  workflows.getById = async () => {
    if (answers.workflow === "found") return {} as never;
    if (answers.workflow === "down") throw new Error("workflow service unreachable");
    throw new WorkflowNotFoundError("workflow_missing");
  };

  return new ExperimentWorkbenchReferencesService({
    prompts,
    agents,
    evaluators,
    workflows,
    dataset,
  });
}

type TargetType = "prompt" | "agent" | "evaluator" | "workflow";

const target = (over: { type: TargetType } & Record<string, unknown>) => ({
  id: "target_1",
  name: "Target",
  inputs: [],
  outputs: [],
  mappings: {},
  ...over,
});

const state = (over: Partial<PersistedEvaluationsV3State> = {}): PersistedEvaluationsV3State =>
  persistedEvaluationsV3StateSchema.parse({
    name: "Workbench",
    datasets: [
      {
        id: "dataset_inline",
        name: "Inline",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
      },
    ],
    activeDatasetId: "dataset_inline",
    targets: [],
    evaluators: [],
    ...over,
  });

const assertAllExist = (
  service: ExperimentWorkbenchReferencesService,
  value: PersistedEvaluationsV3State,
) => service.assertAllExist({ projectId: "project_1", state: value });

describe("ExperimentWorkbenchReferencesService.assertAllExist", () => {
  describe("given a state that names nothing", () => {
    it("passes without asking any feature", async () => {
      await expect(assertAllExist(servicesAnswering(), state())).resolves.toBeUndefined();
    });
  });

  describe("given a prompt target", () => {
    const withPrompt = state({ targets: [target({ type: "prompt", promptId: "prompt_1" })] });

    it("passes when the prompt is in the project's list", async () => {
      const service = servicesAnswering({ prompts: [{ id: "prompt_1" }] });

      await expect(assertAllExist(service, withPrompt)).resolves.toBeUndefined();
    });

    it("matches a prompt by its handle as well as its id", async () => {
      const service = servicesAnswering({ prompts: [{ id: "other", handle: "prompt_1" }] });

      await expect(assertAllExist(service, withPrompt)).resolves.toBeUndefined();
    });

    it("refuses when the prompt is gone, naming what is missing", async () => {
      const service = servicesAnswering({ prompts: [] });

      const error = await assertAllExist(service, withPrompt).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(WorkbenchMissingReferenceError);
      expect(error).toMatchObject({ meta: { refType: "prompt", refId: "prompt_1" } });
    });
  });

  describe("given an agent target", () => {
    const withAgent = state({ targets: [target({ type: "agent", dbAgentId: "agent_1" })] });

    it("passes when the agent exists", async () => {
      await expect(
        assertAllExist(servicesAnswering({ agentExists: true }), withAgent),
      ).resolves.toBeUndefined();
    });

    it("refuses when it does not", async () => {
      await expect(
        assertAllExist(servicesAnswering({ agentExists: false }), withAgent),
      ).rejects.toBeInstanceOf(WorkbenchMissingReferenceError);
    });
  });

  describe("given a saved dataset", () => {
    const withDataset = state({
      datasets: [
        {
          id: "dataset_1",
          name: "Saved",
          type: "saved",
          datasetId: "dataset_1",
          columns: [{ id: "input", name: "input", type: "string" }],
        },
      ],
      activeDatasetId: "dataset_1",
    });

    it("passes when the dataset is still there", async () => {
      await expect(
        assertAllExist(servicesAnswering({ datasetIds: ["dataset_1"] }), withDataset),
      ).resolves.toBeUndefined();
    });

    it("refuses when it has been deleted", async () => {
      await expect(
        assertAllExist(servicesAnswering({ datasetIds: [] }), withDataset),
      ).rejects.toBeInstanceOf(WorkbenchMissingReferenceError);
    });
  });

  describe("given an inline dataset", () => {
    it("asks nobody about it, because it has no id to look up", async () => {
      await expect(assertAllExist(servicesAnswering(), state())).resolves.toBeUndefined();
    });
  });

  describe("given an evaluator", () => {
    const withEvaluator = state({
      evaluators: [
        {
          id: "evaluator_1",
          evaluatorType: "langevals/llm_boolean",
          inputs: [],
          mappings: {},
          dbEvaluatorId: "db_evaluator_1",
        },
      ],
    });

    it("passes when it exists", async () => {
      await expect(
        assertAllExist(servicesAnswering({ evaluator: "found" }), withEvaluator),
      ).resolves.toBeUndefined();
    });

    it("refuses when the evaluator service says it is not found", async () => {
      await expect(
        assertAllExist(servicesAnswering({ evaluator: "missing" }), withEvaluator),
      ).rejects.toBeInstanceOf(WorkbenchMissingReferenceError);
    });

    it("propagates any other failure rather than calling it deleted", async () => {
      // A service that is DOWN is a retry. Turning it into "your evaluator is
      // gone" would tell the customer to fix a workbench that is fine.
      await expect(
        assertAllExist(servicesAnswering({ evaluator: "down" }), withEvaluator),
      ).rejects.toThrow("evaluator service unreachable");
    });
  });

  describe("given a workflow target", () => {
    const withWorkflow = state({
      targets: [target({ type: "workflow", workflowId: "workflow_1" })],
    });

    it("passes when it exists", async () => {
      await expect(
        assertAllExist(servicesAnswering({ workflow: "found" }), withWorkflow),
      ).resolves.toBeUndefined();
    });

    it("refuses when the workflow service says it is not found", async () => {
      await expect(
        assertAllExist(servicesAnswering({ workflow: "missing" }), withWorkflow),
      ).rejects.toBeInstanceOf(WorkbenchMissingReferenceError);
    });

    it("propagates any other failure rather than calling it deleted", async () => {
      await expect(
        assertAllExist(servicesAnswering({ workflow: "down" }), withWorkflow),
      ).rejects.toThrow("workflow service unreachable");
    });
  });

  describe("given several references of the same type", () => {
    it("refuses on the first one that is missing", async () => {
      const service = servicesAnswering({ prompts: [{ id: "prompt_1" }] });
      const twoPrompts = state({
        targets: [
          target({ id: "target_1", type: "prompt", promptId: "prompt_1" }),
          target({ id: "target_2", type: "prompt", promptId: "prompt_2" }),
        ],
      });

      const error = await assertAllExist(service, twoPrompts).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ meta: { refId: "prompt_2" } });
    });
  });
});
