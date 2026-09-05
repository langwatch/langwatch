/**
 * The run's sandbox credential must reach the workflow a code node executes
 * — `mintRunSandboxApiKey` and `withSandboxApiKey` existed but were never
 * wired together. Pins the wiring: the dispatched event carries `sandbox_api_key`.
 * @see specs/experiments-v3/evaluation-execution.feature
 */
import type { StudioServerEvent, WorkflowService } from "@langwatch/workflow-contract";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ExperimentRunOrchestratorService,
  type ExperimentRunPorts,
} from "../experiment-run-orchestrator.service";
import type { ExecutionCell } from "@langwatch/experiment-contract";

const datasetColumns = [{ id: "input", name: "input", type: "string" }];

const scripted: {
  dispatched: Array<{ type: string; payload: Record<string, any> }>;
} = { dispatched: [] };

const resetBoundary = () => {
  scripted.dispatched = [];
};

const ports = {
  studio: {
    postEvent: async ({
      event,
    }: {
      event: { type: string; payload: Record<string, any> };
      onEvent: (event: StudioServerEvent) => void;
    }) => {
      scripted.dispatched.push(event);
    },
  },
  cost: { priceMetrics: async () => undefined },
} as unknown as ExperimentRunPorts;

const workflows = {
  enrichStudioEvent: async ({ event }: { event: unknown }) => event,
  prepareStudioEvent: async ({ event }: { event: unknown }) => event,
} as unknown as WorkflowService;

const makeCell = (): ExecutionCell => ({
  rowIndex: 0,
  targetId: "target-1",
  targetConfig: {
    id: "target-1",
    type: "prompt",
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {},
    localPromptConfig: {
      llm: { model: "openai/gpt-5-mini", temperature: 0 },
      messages: [{ role: "user", content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  } as unknown as ExecutionCell["targetConfig"],
  evaluatorConfigs: [],
  datasetEntry: { _datasetId: "dataset-1", input: "hi" },
  skipTarget: false,
});

beforeEach(resetBoundary);

describe("given a run that minted a sandbox credential", () => {
  describe("when a cell dispatches its target event", () => {
    /** @scenario "The run's sandbox credential reaches the code it executes" */
    it("carries the credential on the dispatched workflow", async () => {
      const loadedData = { sandboxApiKey: "sandbox-key-123" };

      for await (const _event of ExperimentRunOrchestratorService.executeCell(
        makeCell(),
        "p1",
        ports,
        datasetColumns,
        loadedData,
        workflows,
      )) {
        // draining the generator is what triggers the dispatch
      }

      expect(scripted.dispatched).toHaveLength(1);
      expect(
        (scripted.dispatched[0]?.payload.workflow as { sandbox_api_key?: string }).sandbox_api_key,
      ).toBe("sandbox-key-123");
    });
  });

  describe("when the run minted no credential", () => {
    /** @scenario "The run's sandbox credential reaches the code it executes" */
    it("dispatches the workflow with no sandbox_api_key field", async () => {
      const loadedData = { sandboxApiKey: undefined };

      for await (const _event of ExperimentRunOrchestratorService.executeCell(
        makeCell(),
        "p1",
        ports,
        datasetColumns,
        loadedData,
        workflows,
      )) {
        // draining the generator is what triggers the dispatch
      }

      expect(scripted.dispatched).toHaveLength(1);
      expect(
        (scripted.dispatched[0]?.payload.workflow as { sandbox_api_key?: string }).sandbox_api_key,
      ).toBeUndefined();
    });
  });
});
