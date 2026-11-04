import type { AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * A run loads a column left empty in every row as empty text, and adds no
 * column the dataset does not have.
 * @see specs/experiments-v3/execution-inputs.feature
 */
import { describe, expect, it } from "vitest";

import {
  ExperimentExecutionDataService,
  type ExperimentWorkflowDsl,
} from "../experiment-execution-data.service.ts";

const services = () => ({
  datasets: createApiFixture<DatasetApi>(),
  prompts: createApiFixture<PromptApi>(),
  agents: createApiFixture<AgentApi>(),
  workflows: createApiFixture<ExperimentWorkflowDsl>(),
  entitlements: {
    requestBound: ({ key }: { key: RequestBoundKey; organizationId: string }) =>
      Promise.resolve(resolveRequestBound(key, "FREE")),
  },
  projects: { getOrganizationId: async (projectId: string) => `organization-of-${projectId}` },
});

/** The workbench's inline dataset: records keyed by column id, one array per column. */
const loadWorkbenchDataset = ({
  records,
  parameters,
}: {
  records: Record<string, string[]>;
  parameters?: Record<string, string>;
}) =>
  ExperimentExecutionDataService.create().loadExecutionData({
    projectId: "project-1",
    dataset: {
      type: "inline",
      columns: [],
      inline: {
        columns: [
          { id: "input_0", name: "input", type: "string" },
          { id: "environment_1", name: "environment", type: "string" },
        ],
        records,
      },
    },
    targets: [],
    evaluators: [],
    services: services(),
    ...(parameters ? { inputs: { parameters } } : {}),
  });

describe("loadExecutionData", () => {
  describe("given a column no row has a value in", () => {
    /** @scenario "A column empty in every row is sent as empty text" */
    it("loads every row with that column as empty text", async () => {
      const { datasetRows } = await loadWorkbenchDataset({
        records: { input_0: ["hi", "there"], environment_1: [] },
      });

      expect(datasetRows.map((row) => row.environment)).toEqual(["", ""]);
    });

    /** @scenario "A parameter overrides a column that is empty in every row" */
    it("loads the run parameter's value in that column on every row", async () => {
      const { datasetRows } = await loadWorkbenchDataset({
        records: { input_0: ["hi", "there"], environment_1: [] },
        parameters: { environment: "staging" },
      });

      expect(datasetRows.map((row) => row.environment)).toEqual(["staging", "staging"]);
    });
  });

  describe("given rows sent with the request that carry no such key", () => {
    /** @scenario "A column the dataset does not have is not added to the rows" */
    it("adds no key the rows do not carry", async () => {
      const { datasetRows } = await ExperimentExecutionDataService.create().loadExecutionData({
        projectId: "project-1",
        dataset: { type: "inline", columns: [] },
        targets: [],
        evaluators: [],
        services: services(),
        inputs: { data: [{ input: "hi" }] },
      });

      expect(datasetRows[0]).not.toHaveProperty("environment");
    });
  });
});
