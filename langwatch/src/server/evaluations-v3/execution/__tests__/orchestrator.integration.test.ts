import { describe, it, expect, beforeAll } from "vitest";
import type { Project } from "@prisma/client";
import { runOrchestrator, type OrchestratorInput } from "../orchestrator";
import { abortManager } from "../abortManager";
import type { EvaluationV3Event, ExecutionScope } from "../types";
import type { EvaluationsV3State, LocalPromptConfig, TargetConfig, EvaluatorConfig } from "~/evaluations-v3/types";
import { createInitialUIState, createInitialResults } from "~/evaluations-v3/types";
import { getTestProject } from "~/utils/testUtils";

/**
 * Integration tests for the orchestrator against langwatch_nlp.
 * Requires:
 * - LANGWATCH_NLP_SERVICE running on localhost:5561
 * - OPENAI_API_KEY in environment
 * - Redis available (for abort flags)
 * - Database available for test project
 */
describe("Orchestrator Integration", () => {
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
    project = await getTestProject("orchestrator-integration");
  });

  // Helper to create a simple prompt config
  const createPromptConfig = (): LocalPromptConfig => ({
    llm: {
      model: "openai/gpt-4o-mini",
      temperature: 0,
      maxTokens: 50,
    },
    messages: [
      { role: "system", content: "You are a helpful assistant. Respond with only the exact word requested." },
      { role: "user", content: "{{input}}" },
    ],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  });

  // Helper to create a target config
  const createTargetConfig = (id: string, name: string): TargetConfig => ({
    id,
    type: "prompt",
    name,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "dataset-1": {
        input: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "question" },
      },
    },
    localPromptConfig: createPromptConfig(),
  });

  // Helper to create evaluator config
  const createEvaluatorConfig = (): EvaluatorConfig => ({
    id: "eval-1",
    evaluatorType: "langevals/exact_match",
    name: "Exact Match",
    settings: {},
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      "dataset-1": {
        "target-1": {
          output: { type: "source", source: "target", sourceId: "target-1", sourceField: "output" },
          expected_output: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "expected" },
        },
        "target-2": {
          output: { type: "source", source: "target", sourceId: "target-2", sourceField: "output" },
          expected_output: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "expected" },
        },
      },
    },
  });

  // Helper to create test state
  const createTestState = (
    targets: TargetConfig[],
    evaluators: EvaluatorConfig[] = []
  ): EvaluationsV3State => ({
    name: "Test Evaluation",
    datasets: [{
      id: "dataset-1",
      name: "Test Dataset",
    } as EvaluationsV3State["datasets"][0]],
    activeDatasetId: "dataset-1",
    targets,
    evaluators,
    results: createInitialResults(),
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  });

  // Helper to collect all events from orchestrator
  const collectEvents = async (input: OrchestratorInput): Promise<EvaluationV3Event[]> => {
    const events: EvaluationV3Event[] = [];
    for await (const event of runOrchestrator(input)) {
      events.push(event);
    }
    return events;
  };

  describe("single target execution", () => {
    it("executes single row with single target", async () => {
      const state = createTestState([createTargetConfig("target-1", "GPT-4o Mini")]);
      const datasetRows = [{ question: "Say hello", expected: "hello" }];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Check event sequence
      expect(events[0]?.type).toBe("execution_started");
      expect(events.some((e) => e.type === "cell_started")).toBe(true);
      expect(events.some((e) => e.type === "target_result")).toBe(true);
      expect(events.some((e) => e.type === "progress")).toBe(true);
      expect(events[events.length - 1]?.type).toBe("done");

      // Check execution_started event
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.runId).toBeDefined();
        expect(startEvent.total).toBe(1);
      }

      // Check done event
      const doneEvent = events[events.length - 1];
      if (doneEvent?.type === "done") {
        expect(doneEvent.summary.totalCells).toBe(1);
        expect(doneEvent.summary.completedCells + doneEvent.summary.failedCells).toBe(1);
      }
    }, 60000);

    it("executes multiple rows with single target", async () => {
      const state = createTestState([createTargetConfig("target-1", "GPT-4o Mini")]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" },
        { question: "Say world", expected: "world" },
        { question: "Say test", expected: "test" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should have 3 cells
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(3);
      }

      // Should have 3 cell_started events
      const cellStartedEvents = events.filter((e) => e.type === "cell_started");
      expect(cellStartedEvents).toHaveLength(3);

      // Check done event
      const doneEvent = events[events.length - 1];
      if (doneEvent?.type === "done") {
        expect(doneEvent.summary.totalCells).toBe(3);
      }
    }, 120000);

    it("includes duration and traceId in target_result events", async () => {
      const state = createTestState([createTargetConfig("target-1", "GPT-4o Mini")]);
      const datasetRows = [{ question: "Say hello", expected: "hello" }];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Find target_result events
      const targetResults = events.filter((e) => e.type === "target_result") as Array<
        Extract<EvaluationV3Event, { type: "target_result" }>
      >;
      expect(targetResults.length).toBeGreaterThan(0);

      // Check that duration is present and positive
      for (const result of targetResults) {
        if (!result.error) {
          expect(result.duration).toBeDefined();
          expect(typeof result.duration).toBe("number");
          expect(result.duration).toBeGreaterThan(0);

          // traceId should also be present for successful executions
          expect(result.traceId).toBeDefined();
          expect(typeof result.traceId).toBe("string");
        }
      }
    }, 60000);
  });

  describe("multi-target execution", () => {
    it("executes single row with multiple targets", async () => {
      const state = createTestState([
        createTargetConfig("target-1", "Target 1"),
        createTargetConfig("target-2", "Target 2"),
      ]);
      const datasetRows = [{ question: "Say hello", expected: "hello" }];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should have 2 cells (1 row × 2 targets)
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(2);
      }

      // Should have 2 cell_started events for different targets
      const cellStartedEvents = events.filter((e) => e.type === "cell_started");
      expect(cellStartedEvents).toHaveLength(2);

      const targetIds = cellStartedEvents.map((e) =>
        e.type === "cell_started" ? e.targetId : null
      );
      expect(targetIds).toContain("target-1");
      expect(targetIds).toContain("target-2");
    }, 120000);

    it("executes multiple rows with multiple targets in parallel", async () => {
      const state = createTestState([
        createTargetConfig("target-1", "Target 1"),
        createTargetConfig("target-2", "Target 2"),
      ]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" },
        { question: "Say world", expected: "world" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should have 4 cells (2 rows × 2 targets)
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(4);
      }

      // Check done event
      const doneEvent = events[events.length - 1];
      if (doneEvent?.type === "done") {
        expect(doneEvent.summary.totalCells).toBe(4);
      }
    }, 180000);
  });

  describe("partial execution scopes", () => {
    it("executes only specified rows", async () => {
      const state = createTestState([createTargetConfig("target-1", "Target 1")]);
      const datasetRows = [
        { question: "Say one", expected: "one" },
        { question: "Say two", expected: "two" },
        { question: "Say three", expected: "three" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "rows", rowIndices: [0, 2] },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should only execute rows 0 and 2
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(2);
      }

      const cellStartedEvents = events.filter((e) => e.type === "cell_started");
      expect(cellStartedEvents).toHaveLength(2);

      const rowIndices = cellStartedEvents.map((e) =>
        e.type === "cell_started" ? e.rowIndex : null
      );
      expect(rowIndices).toContain(0);
      expect(rowIndices).toContain(2);
      expect(rowIndices).not.toContain(1);
    }, 120000);

    it("executes only specified target", async () => {
      const state = createTestState([
        createTargetConfig("target-1", "Target 1"),
        createTargetConfig("target-2", "Target 2"),
      ]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" },
        { question: "Say world", expected: "world" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "target", targetId: "target-2" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should only execute target-2 (2 rows)
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(2);
      }

      const cellStartedEvents = events.filter((e) => e.type === "cell_started");
      expect(cellStartedEvents).toHaveLength(2);

      // All cells should be for target-2
      for (const event of cellStartedEvents) {
        if (event.type === "cell_started") {
          expect(event.targetId).toBe("target-2");
        }
      }
    }, 120000);

    it("executes single cell", async () => {
      const state = createTestState([
        createTargetConfig("target-1", "Target 1"),
        createTargetConfig("target-2", "Target 2"),
      ]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" },
        { question: "Say world", expected: "world" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "cell", rowIndex: 1, targetId: "target-2" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should only execute 1 cell
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(1);
      }

      const cellStartedEvents = events.filter((e) => e.type === "cell_started");
      expect(cellStartedEvents).toHaveLength(1);

      const cellEvent = cellStartedEvents[0];
      if (cellEvent?.type === "cell_started") {
        expect(cellEvent.rowIndex).toBe(1);
        expect(cellEvent.targetId).toBe("target-2");
      }
    }, 60000);
  });

  describe("error handling", () => {
    it("handles target error gracefully and continues", async () => {
      // Create a target with invalid model to trigger error
      const badTarget: TargetConfig = {
        id: "target-bad",
        type: "prompt",
        name: "Bad Target",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "dataset-1": {
            input: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "question" },
          },
        },
        localPromptConfig: {
          llm: { model: "openai/nonexistent-model-xyz", temperature: 0, maxTokens: 50 },
          messages: [{ role: "user", content: "{{input}}" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
      };

      const state = createTestState([
        createTargetConfig("target-1", "Good Target"),
        badTarget,
      ]);
      const datasetRows = [{ question: "Say hello", expected: "hello" }];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should complete despite error
      expect(events[events.length - 1]?.type).toBe("done");

      // Should have at least one successful result and one error
      const targetResults = events.filter((e) => e.type === "target_result");
      const errors = events.filter((e) => e.type === "error" || (e.type === "target_result" && (e as any).error));

      expect(targetResults.length + errors.length).toBeGreaterThan(0);

      // Check summary shows failures
      const doneEvent = events[events.length - 1];
      if (doneEvent?.type === "done") {
        expect(doneEvent.summary.failedCells).toBeGreaterThanOrEqual(1);
      }
    }, 120000);
  });

  describe("evaluator execution", () => {
    it("executes evaluators after target and returns evaluator_result events", async () => {
      const state = createTestState(
        [createTargetConfig("target-1", "GPT-4o Mini")],
        [createEvaluatorConfig()]  // Add exact_match evaluator
      );
      const datasetRows = [
        { question: "Say hello", expected: "hello" },  // May or may not match
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should have target_result events
      const targetResults = events.filter((e) => e.type === "target_result");
      expect(targetResults.length).toBeGreaterThanOrEqual(1);

      // Should have evaluator_result events (one per row per evaluator per target)
      const evaluatorResults = events.filter((e) => e.type === "evaluator_result");
      expect(evaluatorResults.length).toBeGreaterThanOrEqual(1);

      // Each evaluator result should have the correct structure
      for (const event of evaluatorResults) {
        if (event.type === "evaluator_result") {
          expect(event.rowIndex).toBeDefined();
          expect(event.targetId).toBe("target-1");
          expect(event.evaluatorId).toBe("eval-1");
          expect(event.result).toBeDefined();
          expect(event.result.status).toMatch(/^(processed|error|skipped)$/);
        }
      }

      // Verify completion
      const doneEvent = events[events.length - 1];
      expect(doneEvent?.type).toBe("done");
    }, 120000);

    it("strips score from exact_match evaluator results", async () => {
      // exact_match is a binary evaluator, its score (0 or 1) should be stripped
      // as it's redundant with the passed field
      const state = createTestState(
        [createTargetConfig("target-1", "GPT-4o Mini")],
        [createEvaluatorConfig()]
      );
      const datasetRows = [
        { question: "Say hello", expected: "hello" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Get the evaluator results
      const evaluatorResults = events.filter((e) => e.type === "evaluator_result");
      expect(evaluatorResults.length).toBeGreaterThanOrEqual(1);

      // Each evaluator result should NOT have a score (score should be stripped)
      for (const event of evaluatorResults) {
        if (event.type === "evaluator_result" && event.result.status === "processed") {
          expect(event.result.score).toBeUndefined();
          // But should still have passed field
          expect(event.result.passed).toBeDefined();
        }
      }
    }, 120000);

    it("handles evaluator errors gracefully", async () => {
      // Create an evaluator with potentially missing inputs to trigger an error path
      const evaluatorWithBadMapping: EvaluatorConfig = {
        id: "eval-bad",
        evaluatorType: "langevals/exact_match",
        name: "Bad Evaluator",
        settings: {},
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        mappings: {
          "dataset-1": {
            "target-1": {
              // Missing output mapping - should cause error or be handled gracefully
              expected_output: { type: "source", source: "dataset", sourceId: "dataset-1", sourceField: "expected" },
            },
          },
        },
      };

      const state = createTestState(
        [createTargetConfig("target-1", "GPT-4o Mini")],
        [evaluatorWithBadMapping]
      );
      const datasetRows = [{ question: "Say hello", expected: "hello" }];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should still complete
      expect(events[events.length - 1]?.type).toBe("done");

      // Target should still succeed even if evaluator fails
      const targetResults = events.filter((e) => e.type === "target_result");
      expect(targetResults.length).toBeGreaterThanOrEqual(1);
    }, 120000);
  });

  describe("execution summary", () => {
    it("provides accurate summary with duration", async () => {
      const state = createTestState([createTargetConfig("target-1", "Target 1")]);
      const datasetRows = [{ question: "Say hello", expected: "hello" }];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const startTime = Date.now();

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);
      const endTime = Date.now();

      const doneEvent = events[events.length - 1];
      expect(doneEvent?.type).toBe("done");

      if (doneEvent?.type === "done") {
        const { summary } = doneEvent;
        expect(summary.runId).toMatch(/^run_/);
        expect(summary.duration).toBeGreaterThan(0);
        expect(summary.duration).toBeLessThanOrEqual(endTime - startTime + 1000);
        expect(summary.timestamps.startedAt).toBeGreaterThanOrEqual(startTime);
        expect(summary.timestamps.finishedAt).toBeLessThanOrEqual(endTime + 1000);
      }
    }, 60000);
  });

  describe("abort functionality", () => {
    it("stops execution when abort flag is set and emits stopped event", async () => {
      // Create state with multiple rows to ensure we can abort mid-execution
      const state = createTestState([createTargetConfig("target-1", "Target 1")]);
      const datasetRows = [
        { question: "Say one", expected: "one" },
        { question: "Say two", expected: "two" },
        { question: "Say three", expected: "three" },
        { question: "Say four", expected: "four" },
        { question: "Say five", expected: "five" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events: EvaluationV3Event[] = [];
      let runId: string | undefined;

      // Collect events and set abort after getting first result
      for await (const event of runOrchestrator(input)) {
        events.push(event);

        // Capture runId from execution_started
        if (event.type === "execution_started") {
          runId = event.runId;
        }

        // After first target result, request abort
        if (event.type === "target_result" && runId) {
          await abortManager.requestAbort(runId);
        }
      }

      // Should end with stopped event, not done
      const lastEvent = events[events.length - 1];
      expect(lastEvent?.type).toBe("stopped");

      // Should have at least one result but not all 5
      const targetResults = events.filter((e) => e.type === "target_result");
      expect(targetResults.length).toBeGreaterThanOrEqual(1);
      expect(targetResults.length).toBeLessThan(5);

      // Stopped event just indicates the reason - 'user' for abort
      if (lastEvent?.type === "stopped") {
        expect(lastEvent.reason).toBe("user");
      }
    }, 120000);

    it("preserves partial results when aborted", async () => {
      const state = createTestState([createTargetConfig("target-1", "Target 1")]);
      const datasetRows = [
        { question: "Say alpha", expected: "alpha" },
        { question: "Say beta", expected: "beta" },
        { question: "Say gamma", expected: "gamma" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events: EvaluationV3Event[] = [];
      let runId: string | undefined;
      let abortRequested = false;

      for await (const event of runOrchestrator(input)) {
        events.push(event);

        if (event.type === "execution_started") {
          runId = event.runId;
        }

        // Request abort after first result
        if (event.type === "target_result" && runId && !abortRequested) {
          abortRequested = true;
          await abortManager.requestAbort(runId);
        }
      }

      // Collect all successful target results
      const successfulResults = events.filter(
        (e) => e.type === "target_result" && !("error" in e && e.error)
      );

      // Should have at least one result preserved
      expect(successfulResults.length).toBeGreaterThanOrEqual(1);

      // Each result should have output
      for (const result of successfulResults) {
        if (result.type === "target_result") {
          expect(result.output).toBeDefined();
          expect(result.rowIndex).toBeDefined();
        }
      }
    }, 120000);
  });

  describe("empty row handling", () => {
    it("skips completely empty rows in full execution", async () => {
      const state = createTestState([createTargetConfig("target-1", "GPT-4o Mini")]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" },  // row 0 - non-empty
        { question: "", expected: "" },                // row 1 - empty (skipped)
        { question: "Say world", expected: "world" },  // row 2 - non-empty
        { question: null, expected: null },            // row 3 - empty (skipped)
        { question: "   ", expected: "   " },          // row 4 - whitespace only (skipped)
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should only execute 2 cells (rows 0 and 2), not 5
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(2);
      }

      // Should only have 2 cell_started events
      const cellStartedEvents = events.filter((e) => e.type === "cell_started");
      expect(cellStartedEvents).toHaveLength(2);

      // Should only have results for rows 0 and 2
      const targetResults = events.filter((e) => e.type === "target_result") as Array<
        Extract<EvaluationV3Event, { type: "target_result" }>
      >;
      expect(targetResults).toHaveLength(2);

      const resultRowIndices = targetResults.map((r) => r.rowIndex).sort();
      expect(resultRowIndices).toEqual([0, 2]);

      // Done event should show only 2 total cells
      const doneEvent = events[events.length - 1];
      if (doneEvent?.type === "done") {
        expect(doneEvent.summary.totalCells).toBe(2);
      }
    }, 60000);

    it("skips empty rows in target scope execution", async () => {
      const state = createTestState([
        createTargetConfig("target-1", "GPT-4o Mini"),
        createTargetConfig("target-2", "GPT-4o Mini 2"),
      ]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" },  // row 0 - non-empty
        { question: "", expected: "" },                // row 1 - empty (skipped)
        { question: "Say world", expected: "world" },  // row 2 - non-empty
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "target", targetId: "target-1" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should only execute 2 cells (rows 0 and 2 for target-1)
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(2);
      }

      // Verify results are for correct rows
      const targetResults = events.filter((e) => e.type === "target_result") as Array<
        Extract<EvaluationV3Event, { type: "target_result" }>
      >;
      const resultRowIndices = targetResults.map((r) => r.rowIndex).sort();
      expect(resultRowIndices).toEqual([0, 2]);
    }, 60000);

    it("executes explicitly requested empty rows in cell scope", async () => {
      // When user explicitly requests a cell, we should attempt it even if empty
      // This test verifies the behavior - currently we skip empty rows in all scopes
      // If we want to change this behavior for explicit cell execution, we can adjust
      const state = createTestState([createTargetConfig("target-1", "GPT-4o Mini")]);
      const datasetRows = [
        { question: "", expected: "" },  // row 0 - empty
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "cell", rowIndex: 0, targetId: "target-1" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Currently skips empty rows even in cell scope
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(0);
      }
    }, 30000);

    it("handles dataset with all empty rows", async () => {
      const state = createTestState([createTargetConfig("target-1", "GPT-4o Mini")]);
      const datasetRows = [
        { question: "", expected: "" },
        { question: null, expected: null },
        { question: "   ", expected: "" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      const input: OrchestratorInput = {
        projectId: project.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should have 0 cells to execute
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(0);
      }

      // Should complete immediately with done event
      const doneEvent = events[events.length - 1];
      if (doneEvent?.type === "done") {
        expect(doneEvent.summary.totalCells).toBe(0);
        expect(doneEvent.summary.completedCells).toBe(0);
      }
    }, 30000);
  });
});
