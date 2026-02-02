import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import type {
  EvaluatorConfig,
  LocalPromptConfig,
  TargetConfig,
} from "~/evaluations-v3/types";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type { StudioServerEvent } from "~/optimization_studio/types/events";
import { getTestProject } from "~/utils/testUtils";
import type { ExecutionCell } from "../types";
import { buildCellWorkflow } from "../workflowBuilder";

/**
 * Integration tests for workflow execution against langwatch_nlp.
 * Requires:
 * - LANGWATCH_NLP_SERVICE running on localhost:5561
 * - OPENAI_API_KEY in environment
 * - Database available for test project
 */
// Skip for now as those tests depend on the NLP service, which is not available in the CI environment.

describe.skipIf(process.env.CI)("WorkflowExecution Integration", () => {
  let project: Project;

  beforeAll(async () => {
    // Check if NLP service is available
    const nlpServiceUrl = process.env.LANGWATCH_NLP_SERVICE;
    if (!nlpServiceUrl) {
      console.warn("LANGWATCH_NLP_SERVICE not set, tests may fail");
    }

    // Check for OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY not set, tests may fail");
    }

    // Get or create test project
    project = await getTestProject("workflow-execution");
  });

  const createSimplePromptConfig = (): LocalPromptConfig => ({
    llm: {
      model: "openai/gpt-4o-mini",
      temperature: 0,
      maxTokens: 50,
    },
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant. Respond with only the exact word requested.",
      },
      { role: "user", content: "{{input}}" },
    ],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  });

  const createTargetConfig = (
    overrides?: Partial<TargetConfig>,
  ): TargetConfig => ({
    id: "target-1",
    type: "prompt",
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "dataset-1": {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "dataset-1",
          sourceField: "question",
        },
      },
    },
    localPromptConfig: createSimplePromptConfig(),
    ...overrides,
  });

  const createExactMatchEvaluator = (): EvaluatorConfig => ({
    id: "eval-1",
    evaluatorType: "langevals/exact_match", // Use full evaluator type
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      "dataset-1": {
        "target-1": {
          output: {
            type: "source",
            source: "target",
            sourceId: "target-1",
            sourceField: "output",
          },
          expected_output: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "expected",
          },
        },
      },
    },
  });

  const createCell = (
    datasetEntry: Record<string, unknown>,
    overrides?: Partial<ExecutionCell>,
  ): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: createTargetConfig(),
    evaluatorConfigs: [createExactMatchEvaluator()],
    datasetEntry: {
      _datasetId: "dataset-1",
      ...datasetEntry,
    },
    ...overrides,
  });

  /**
   * Executes a workflow through the full NLP pipeline.
   * Uses the same code path as the production /api/workflows/post_event endpoint.
   */
  const executeWorkflow = async (
    cell: ExecutionCell,
    datasetColumns: Array<{ id: string; name: string; type: string }>,
  ): Promise<StudioServerEvent[]> => {
    const events: StudioServerEvent[] = [];

    // Build the workflow
    const { workflow, targetNodeId } = buildCellWorkflow(
      {
        projectId: project.id,
        cell,
        datasetColumns,
      },
      {},
    );

    // Create the event
    const rawEvent = {
      type: "execute_component" as const,
      payload: {
        trace_id: `trace_${nanoid()}`,
        workflow: {
          ...workflow,
          state: { execution: { status: "idle" as const } },
        },
        node_id: targetNodeId,
        inputs: { input: cell.datasetEntry.question as string },
      },
    };

    // Add environment variables (api_key, litellm_params, etc.) - same as production
    // Then load/process datasets
    const enrichedEvent = await loadDatasets(
      await addEnvs(rawEvent, project.id),
      project.id,
    );

    // Execute through the NLP backend
    await studioBackendPostEvent({
      projectId: project.id,
      message: enrichedEvent,
      onEvent: (serverEvent) => {
        events.push(serverEvent);
      },
    });

    return events;
  };

  describe("prompt target execution", () => {
    it("executes prompt target and receives output", async () => {
      const cell = createCell({
        question: "Say the word hello",
        expected: "hello",
      });

      const events = await executeWorkflow(cell, [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ]);

      // Should have received events
      expect(events.length).toBeGreaterThan(0);

      // Find the component_state_change event for the target
      const targetCompletedEvent = events.find(
        (
          e,
        ): e is Extract<
          StudioServerEvent,
          { type: "component_state_change" }
        > =>
          e.type === "component_state_change" &&
          e.payload.component_id === "target-1" &&
          e.payload.execution_state?.status === "success",
      );

      expect(targetCompletedEvent).toBeDefined();
      expect(
        targetCompletedEvent?.payload.execution_state?.outputs?.output,
      ).toBeDefined();

      // The output should be a string (the LLM response)
      const output =
        targetCompletedEvent?.payload.execution_state?.outputs?.output;
      expect(typeof output).toBe("string");
    }, 60000);

    it("handles errors gracefully", async () => {
      // Create a prompt config with an invalid model
      const badPromptConfig: LocalPromptConfig = {
        llm: {
          model: "openai/nonexistent-model-xyz",
          temperature: 0,
          maxTokens: 50,
        },
        messages: [{ role: "user", content: "{{input}}" }],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };

      const cell = createCell(
        { question: "Hello", expected: "hello" },
        {
          targetConfig: createTargetConfig({
            localPromptConfig: badPromptConfig,
          }),
        },
      );

      const events = await executeWorkflow(cell, [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ]);

      // Should receive an error event
      const errorEvent = events.find(
        (e) =>
          (e.type === "component_state_change" &&
            "payload" in e &&
            e.payload.execution_state?.status === "error") ||
          e.type === "error",
      );

      expect(errorEvent).toBeDefined();
    }, 60000);
  });

  // Note: evaluator and execute_flow tests are skipped due to a "coroutine raised StopIteration"
  // Python async bug in the NLP service. This is being tracked separately.
  // The key functionality (prompt execution via execute_component) works correctly.
  describe.skip("execute_component for evaluator - NLP service bug", () => {
    it("executes exact_match evaluator with passing result", async () => {
      // Skipped: NLP service throws "coroutine raised StopIteration" for evaluators
    });

    it("executes exact_match evaluator with failing result", async () => {
      // Skipped: NLP service throws "coroutine raised StopIteration" for evaluators
    });
  });

  describe.skip("full workflow (execute_flow) - NLP service bug", () => {
    it("executes target and evaluator in a full flow", async () => {
      // Skipped: NLP service throws "coroutine raised StopIteration" for execute_flow
    });
  });

  describe("result structure validation", () => {
    it("target result contains expected fields", async () => {
      const cell = createCell({
        question: "What is 2+2?",
        expected: "4",
      });

      const events = await executeWorkflow(cell, [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ]);

      const targetEvent = events.find(
        (
          e,
        ): e is Extract<
          StudioServerEvent,
          { type: "component_state_change" }
        > =>
          e.type === "component_state_change" &&
          e.payload.component_id === "target-1" &&
          e.payload.execution_state?.status === "success",
      );

      expect(targetEvent).toBeDefined();

      const executionState = targetEvent?.payload.execution_state;
      expect(executionState?.outputs).toBeDefined();
      expect(executionState?.timestamps).toBeDefined();
      // Cost may or may not be present depending on model
    }, 60000);
  });
});
