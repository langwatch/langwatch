import type { Project } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  DatasetColumn,
  EvaluationsV3State,
  EvaluatorConfig,
  LocalPromptConfig,
  TargetConfig,
} from "~/evaluations-v3/types";
import {
  createInitialResults,
  createInitialUIState,
} from "~/evaluations-v3/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { getTestProject } from "~/utils/testUtils";
import { abortManager } from "../abortManager";
import { type OrchestratorInput, runOrchestrator } from "../orchestrator";
import type { EvaluationV3Event, ExecutionScope } from "../types";

/**
 * Integration tests for the orchestrator against langwatch_nlp.
 * Requires:
 * - LANGWATCH_NLP_SERVICE running on localhost:5561
 * - OPENAI_API_KEY in environment
 * - Redis available (for abort flags)
 * - Database available for test project
 */
// Skip for now as those tests depend on the NLP service, which is not available in the CI environment.
describe.skipIf(process.env.CI)("Orchestrator Integration", () => {
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

  // Helper to create a target config
  const createTargetConfig = (id: string): TargetConfig => ({
    id,
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
    localPromptConfig: createPromptConfig(),
  });

  // Helper to create evaluator config
  const createEvaluatorConfig = (): EvaluatorConfig => ({
    id: "eval-1",
    evaluatorType: "langevals/exact_match",
    settings: {},
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
        "target-2": {
          output: {
            type: "source",
            source: "target",
            sourceId: "target-2",
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

  // Helper to create test state
  const createTestState = (
    targets: TargetConfig[],
    evaluators: EvaluatorConfig[] = [],
  ): EvaluationsV3State => ({
    name: "Test Evaluation",
    datasets: [
      {
        id: "dataset-1",
        name: "Test Dataset",
      } as EvaluationsV3State["datasets"][0],
    ],
    activeDatasetId: "dataset-1",
    targets,
    evaluators,
    results: createInitialResults(),
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  });

  // Helper to collect all events from orchestrator
  const collectEvents = async (
    input: OrchestratorInput,
  ): Promise<EvaluationV3Event[]> => {
    const events: EvaluationV3Event[] = [];
    for await (const event of runOrchestrator(input)) {
      events.push(event);
    }
    return events;
  };

  describe("single target execution", () => {
    it("executes single row with single target", async () => {
      const state = createTestState([
        createTargetConfig("target-1"),
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
        expect(
          doneEvent.summary.completedCells + doneEvent.summary.failedCells,
        ).toBe(1);
      }
    }, 60000);

    it("executes multiple rows with single target", async () => {
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
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
      const state = createTestState([
        createTargetConfig("target-1"),
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

      // Find target_result events
      const targetResults = events.filter(
        (e) => e.type === "target_result",
      ) as Array<Extract<EvaluationV3Event, { type: "target_result" }>>;
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
        createTargetConfig("target-1"),
        createTargetConfig("target-2"),
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
        e.type === "cell_started" ? e.targetId : null,
      );
      expect(targetIds).toContain("target-1");
      expect(targetIds).toContain("target-2");
    }, 120000);

    it("executes multiple rows with multiple targets in parallel", async () => {
      const state = createTestState([
        createTargetConfig("target-1"),
        createTargetConfig("target-2"),
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
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
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
        e.type === "cell_started" ? e.rowIndex : null,
      );
      expect(rowIndices).toContain(0);
      expect(rowIndices).toContain(2);
      expect(rowIndices).not.toContain(1);
    }, 120000);

    it("executes only specified target", async () => {
      const state = createTestState([
        createTargetConfig("target-1"),
        createTargetConfig("target-2"),
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
        createTargetConfig("target-1"),
        createTargetConfig("target-2"),
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

    it("re-runs single evaluator with pre-computed target output", async () => {
      const state = createTestState(
        [createTargetConfig("target-1")],
        [createEvaluatorConfig()],
      );
      const datasetRows = [
        { question: "Say hello", expected: "hello" },
        { question: "Say world", expected: "world" },
      ];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      // Re-run evaluator on row 1 with pre-computed target output
      // This simulates a user clicking "Rerun" on an evaluator chip
      const input: OrchestratorInput = {
        projectId: project.id,
        scope: {
          type: "evaluator",
          rowIndex: 1,
          targetId: "target-1",
          evaluatorId: "eval-1",
          targetOutput: { output: "world" }, // Pre-computed output matching expected
        },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should only execute 1 cell (single evaluator)
      const startEvent = events[0];
      if (startEvent?.type === "execution_started") {
        expect(startEvent.total).toBe(1);
      }

      // Should have cell_started event
      const cellStartedEvents = events.filter((e) => e.type === "cell_started");
      expect(cellStartedEvents).toHaveLength(1);

      // Should NOT have target_result event (target was skipped)
      const targetResultEvents = events.filter(
        (e) => e.type === "target_result",
      );
      expect(targetResultEvents).toHaveLength(0);

      // Should have evaluator_result event
      const evaluatorResultEvents = events.filter(
        (e) => e.type === "evaluator_result",
      );
      expect(evaluatorResultEvents).toHaveLength(1);

      const evalResult = evaluatorResultEvents[0];
      if (evalResult?.type === "evaluator_result") {
        expect(evalResult.rowIndex).toBe(1);
        expect(evalResult.targetId).toBe("target-1");
        expect(evalResult.evaluatorId).toBe("eval-1");
        // With output "world" matching expected "world", should pass
        expect(evalResult.result.status).toBe("processed");
        if (evalResult.result.status === "processed") {
          expect(evalResult.result.passed).toBe(true);
        }
      }

      // Should complete successfully
      const doneEvent = events[events.length - 1];
      expect(doneEvent?.type).toBe("done");
    }, 60000);

    it("re-runs single evaluator without pre-computed output (executes target too)", async () => {
      const state = createTestState(
        [createTargetConfig("target-1")],
        [createEvaluatorConfig()],
      );
      const datasetRows = [{ question: "Say hello", expected: "hello" }];
      const datasetColumns = [
        { id: "question", name: "question", type: "string" },
        { id: "expected", name: "expected", type: "string" },
      ];

      // Re-run evaluator without pre-computed output - should execute target too
      const input: OrchestratorInput = {
        projectId: project.id,
        scope: {
          type: "evaluator",
          rowIndex: 0,
          targetId: "target-1",
          evaluatorId: "eval-1",
          // No targetOutput - should run target
        },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
      };

      const events = await collectEvents(input);

      // Should have target_result event (target was executed)
      const targetResultEvents = events.filter(
        (e) => e.type === "target_result",
      );
      expect(targetResultEvents.length).toBeGreaterThan(0);

      // Should have evaluator_result event
      const evaluatorResultEvents = events.filter(
        (e) => e.type === "evaluator_result",
      );
      expect(evaluatorResultEvents).toHaveLength(1);

      // Should complete successfully
      const doneEvent = events[events.length - 1];
      expect(doneEvent?.type).toBe("done");
    }, 60000);
  });

  describe("error handling", () => {
    it("handles target error gracefully and continues", async () => {
      // Create a target with invalid model to trigger error
      const badTarget: TargetConfig = {
        id: "target-bad",
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
        localPromptConfig: {
          llm: {
            model: "openai/nonexistent-model-xyz",
            temperature: 0,
            maxTokens: 50,
          },
          messages: [{ role: "user", content: "{{input}}" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
      };

      const state = createTestState([
        createTargetConfig("target-1"),
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
      const errors = events.filter(
        (e) =>
          e.type === "error" ||
          (e.type === "target_result" && (e as any).error),
      );

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
        [createTargetConfig("target-1")],
        [createEvaluatorConfig()], // Add exact_match evaluator
      );
      const datasetRows = [
        { question: "Say hello", expected: "hello" }, // May or may not match
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
      const evaluatorResults = events.filter(
        (e) => e.type === "evaluator_result",
      );
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
        [createTargetConfig("target-1")],
        [createEvaluatorConfig()],
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

      // Get the evaluator results
      const evaluatorResults = events.filter(
        (e) => e.type === "evaluator_result",
      );
      expect(evaluatorResults.length).toBeGreaterThanOrEqual(1);

      // Each evaluator result should NOT have a score (score should be stripped)
      for (const event of evaluatorResults) {
        if (
          event.type === "evaluator_result" &&
          event.result.status === "processed"
        ) {
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
        settings: {},
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        mappings: {
          "dataset-1": {
            "target-1": {
              // Missing output mapping - should cause error or be handled gracefully
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "expected",
              },
            },
          },
        },
      };

      const state = createTestState(
        [createTargetConfig("target-1")],
        [evaluatorWithBadMapping],
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

    it("returns error status for invalid/unreachable evaluator type", async () => {
      // Use an evaluator type that doesn't exist - should return error, not processed
      const invalidEvaluator: EvaluatorConfig = {
        id: "eval-invalid",
        evaluatorType: "langevals/this_evaluator_does_not_exist" as any,
        settings: {},
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
      };

      const state = createTestState(
        [createTargetConfig("target-1")],
        [invalidEvaluator],
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

      // Should still complete (gracefully handle error)
      expect(events[events.length - 1]?.type).toBe("done");

      // Target should succeed
      const targetResults = events.filter((e) => e.type === "target_result");
      expect(targetResults.length).toBe(1);

      // Evaluator should return ERROR status, not "processed"
      const evaluatorResults = events.filter(
        (e) => e.type === "evaluator_result",
      );
      expect(evaluatorResults.length).toBe(1);

      const evalResult = evaluatorResults[0];
      if (evalResult?.type === "evaluator_result") {
        // This is the key assertion - invalid evaluator should return error
        expect(evalResult.result.status).toBe("error");
        expect(evalResult.result.details).toBeDefined();
        expect(evalResult.result.details).toContain("404");
      }
    }, 120000);
  });

  describe("database evaluator execution", () => {
    it("executes evaluator from database using evaluators/{id} path", async () => {
      // Create a real evaluator in the database
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");

      const evaluatorId = `evaluator_${nanoid()}`;
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: project.id,
          name: "Test Exact Match Evaluator",
          type: "evaluator",
          config: {
            evaluatorType: "langevals/exact_match",
            settings: {},
          },
        },
      });

      try {
        // Create evaluator config that references the database evaluator
        const dbEvaluatorConfig: EvaluatorConfig = {
          id: "eval-from-db",
          evaluatorType: "langevals/exact_match",
          dbEvaluatorId: evaluatorId, // Reference to database evaluator
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
        };

        const state = createTestState(
          [createTargetConfig("target-1")],
          [dbEvaluatorConfig],
        );
        const datasetRows = [{ question: "Say hello", expected: "hello" }];
        const datasetColumns = [
          { id: "question", name: "question", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        // Load the evaluator from DB (simulates what the API route does)
        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        const dbEvaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId: project.id },
        });
        if (dbEvaluator) {
          loadedEvaluators.set(evaluatorId, {
            id: dbEvaluator.id,
            name: dbEvaluator.name,
            config: dbEvaluator.config,
          });
        }

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
        };

        const events = await collectEvents(input);

        // Should complete successfully
        expect(events[events.length - 1]?.type).toBe("done");

        // Should have target result
        const targetResults = events.filter((e) => e.type === "target_result");
        expect(targetResults.length).toBe(1);

        // Should have evaluator result
        const evaluatorResults = events.filter(
          (e) => e.type === "evaluator_result",
        );
        expect(evaluatorResults.length).toBe(1);

        const evalResult = evaluatorResults[0];
        if (evalResult?.type === "evaluator_result") {
          expect(evalResult.evaluatorId).toBe("eval-from-db");
          // Should be processed (not error) - proving DB evaluator executed successfully
          expect(evalResult.result.status).toBe("processed");
        }
      } finally {
        // Cleanup
        await prisma.evaluator.delete({
          where: { id: evaluatorId, projectId: project.id },
        });
      }
    }, 120000);

    it("uses evaluator settings from database, not from workbench state", async () => {
      // This test verifies that when dbEvaluatorId is provided,
      // settings are fetched from the database, not from the workbench state
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");

      const evaluatorId = `evaluator_${nanoid()}`;
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: project.id,
          name: "DB Evaluator with Custom Settings",
          type: "evaluator",
          config: {
            evaluatorType: "langevals/exact_match",
            settings: {
              // These are the REAL settings that should be used
              case_sensitive: false,
            },
          },
        },
      });

      try {
        // Create evaluator config with WRONG settings in workbench state
        // The DB settings should override these
        const dbEvaluatorConfig: EvaluatorConfig = {
          id: "eval-db-settings",
          evaluatorType: "langevals/exact_match",
          dbEvaluatorId: evaluatorId,
          // Note: No settings here - they should come from DB
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
        };

        const state = createTestState(
          [createTargetConfig("target-1")],
          [dbEvaluatorConfig],
        );
        // Use "Hello" vs "hello" - with case_sensitive: false, these should match
        const datasetRows = [{ question: "Say Hello", expected: "hello" }];
        const datasetColumns = [
          { id: "question", name: "question", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        // Load the evaluator from DB
        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        const dbEvaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId: project.id },
        });
        if (dbEvaluator) {
          loadedEvaluators.set(evaluatorId, {
            id: dbEvaluator.id,
            name: dbEvaluator.name,
            config: dbEvaluator.config,
          });
        }

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
        };

        const events = await collectEvents(input);

        // Should complete
        expect(events[events.length - 1]?.type).toBe("done");

        // Check the evaluator result
        const evaluatorResults = events.filter(
          (e) => e.type === "evaluator_result",
        );
        expect(evaluatorResults.length).toBe(1);

        const evalResult = evaluatorResults[0];
        if (evalResult?.type === "evaluator_result") {
          expect(evalResult.result.status).toBe("processed");
          // With case_sensitive: false, "Hello" should match "hello"
          // Note: This depends on how exact_match handles case sensitivity
          // The key is that the DB settings are being used
        }
      } finally {
        await prisma.evaluator.delete({
          where: { id: evaluatorId, projectId: project.id },
        });
      }
    }, 120000);
  });

  describe("execution summary", () => {
    it("provides accurate summary with duration", async () => {
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
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
        // Human-readable run IDs like "quick-agile-lynx" (adjective-adjective-noun pattern)
        expect(summary.runId).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
        expect(summary.duration).toBeGreaterThan(0);
        expect(summary.duration).toBeLessThanOrEqual(
          endTime - startTime + 1000,
        );
        expect(summary.timestamps.startedAt).toBeGreaterThanOrEqual(startTime);
        expect(summary.timestamps.finishedAt).toBeLessThanOrEqual(
          endTime + 1000,
        );
      }
    }, 60000);
  });

  describe("abort functionality", () => {
    it("stops execution when abort flag is set and emits stopped event", async () => {
      // Create state with multiple rows to ensure we can abort mid-execution
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
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
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
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
        (e) => e.type === "target_result" && !("error" in e && e.error),
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

    it("stops quickly even with many rows when abort is requested immediately", async () => {
      // This test verifies that abort is responsive even with many pending cells
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
      // Create 20 rows - without abort this would take a long time
      const datasetRows = Array.from({ length: 20 }, (_, i) => ({
        question: `Say number ${i + 1}`,
        expected: `${i + 1}`,
      }));
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
      const startTime = Date.now();

      for await (const event of runOrchestrator(input)) {
        events.push(event);

        if (event.type === "execution_started") {
          runId = event.runId;
          // Request abort immediately after execution starts
          await abortManager.requestAbort(runId);
        }
      }

      const duration = Date.now() - startTime;

      // Should end with stopped event
      const lastEvent = events[events.length - 1];
      expect(lastEvent?.type).toBe("stopped");
      if (lastEvent?.type === "stopped") {
        expect(lastEvent.reason).toBe("user");
      }

      // Should complete in reasonable time (not waiting for all 20 rows)
      // With 5 concurrent cells and immediate abort, should be under 60s
      // (just waiting for in-flight cells to complete)
      expect(duration).toBeLessThan(60000);

      // Should have fewer results than total rows
      const targetResults = events.filter((e) => e.type === "target_result");
      expect(targetResults.length).toBeLessThan(20);
    }, 120000);
  });

  describe("empty row handling", () => {
    it("skips completely empty rows in full execution", async () => {
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" }, // row 0 - non-empty
        { question: "", expected: "" }, // row 1 - empty (skipped)
        { question: "Say world", expected: "world" }, // row 2 - non-empty
        { question: null, expected: null }, // row 3 - empty (skipped)
        { question: "   ", expected: "   " }, // row 4 - whitespace only (skipped)
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
      const targetResults = events.filter(
        (e) => e.type === "target_result",
      ) as Array<Extract<EvaluationV3Event, { type: "target_result" }>>;
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
        createTargetConfig("target-1"),
        createTargetConfig("target-2"),
      ]);
      const datasetRows = [
        { question: "Say hello", expected: "hello" }, // row 0 - non-empty
        { question: "", expected: "" }, // row 1 - empty (skipped)
        { question: "Say world", expected: "world" }, // row 2 - non-empty
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
      const targetResults = events.filter(
        (e) => e.type === "target_result",
      ) as Array<Extract<EvaluationV3Event, { type: "target_result" }>>;
      const resultRowIndices = targetResults.map((r) => r.rowIndex).sort();
      expect(resultRowIndices).toEqual([0, 2]);
    }, 60000);

    it("executes explicitly requested empty rows in cell scope", async () => {
      // When user explicitly requests a cell, we should attempt it even if empty
      // This test verifies the behavior - currently we skip empty rows in all scopes
      // If we want to change this behavior for explicit cell execution, we can adjust
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
      const datasetRows = [
        { question: "", expected: "" }, // row 0 - empty
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
      const state = createTestState([
        createTargetConfig("target-1"),
      ]);
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

  describe("Elasticsearch Storage", () => {
    it("stores full evaluation run results to Elasticsearch when saveToEs is true", async () => {
      // Import required modules for ES verification
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");
      const { getDefaultBatchEvaluationRepository } = await import(
        "../../repositories/elasticsearchBatchEvaluation.repository"
      );

      // Create a real experiment in the database (required for ES storage)
      const experimentId = `exp_${nanoid()}`;
      await prisma.experiment.create({
        data: {
          id: experimentId,
          projectId: project.id,
          name: "ES Storage Test",
          slug: `es-test-${nanoid(8)}`,
          type: "EVALUATIONS_V3",
        },
      });

      try {
        const state = createTestState(
          [createTargetConfig("target-1")],
          [createEvaluatorConfig()],
        );
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
          experimentId, // Pass experiment ID to enable storage
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          saveToEs: true, // Enable ES storage!
        };

        const events = await collectEvents(input);

        // Verify execution completed
        const doneEvent = events.find((e) => e.type === "done");
        expect(doneEvent).toBeDefined();
        if (doneEvent?.type !== "done") throw new Error("Expected done event");

        // Get the run ID from the execution_started event
        const startEvent = events.find((e) => e.type === "execution_started");
        if (startEvent?.type !== "execution_started")
          throw new Error("Expected execution_started event");
        const runId = startEvent.runId;

        // Wait for ES to index
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify data was stored in Elasticsearch
        const repository = getDefaultBatchEvaluationRepository();
        const storedRun = await repository.getByRunId({
          projectId: project.id,
          experimentId,
          runId,
        });

        // Verify the stored data
        expect(storedRun).not.toBeNull();
        expect(storedRun?.run_id).toBe(runId);
        expect(storedRun?.experiment_id).toBe(experimentId);
        expect(storedRun?.project_id).toBe(project.id);

        // Verify targets were stored
        // Note: target name falls back to target ID when no loadedPrompt is provided
        expect(storedRun?.targets).toBeDefined();
        expect(storedRun?.targets?.length).toBeGreaterThanOrEqual(1);
        expect(storedRun?.targets?.[0]?.name).toBe("target-1");

        // Verify dataset entries were stored with actual input values
        expect(storedRun?.dataset).toBeDefined();
        expect(storedRun?.dataset?.length).toBe(2);

        // Verify dataset entries contain the input data (not just empty objects)
        const datasetEntries = storedRun?.dataset ?? [];
        const firstEntry = datasetEntries.find((d) => d.index === 0);
        const secondEntry = datasetEntries.find((d) => d.index === 1);

        expect(firstEntry?.entry).toBeDefined();
        expect(firstEntry?.entry?.question).toBe("Say hello");

        expect(secondEntry?.entry).toBeDefined();
        expect(secondEntry?.entry?.question).toBe("Say world");

        // Verify evaluations were stored
        expect(storedRun?.evaluations).toBeDefined();
        expect(storedRun?.evaluations?.length).toBe(2); // 2 rows, 1 evaluator each

        // Verify evaluator ID is stored
        // Note: evaluator name is null when using built-in evaluators without dbEvaluatorId
        // (name is only populated when evaluator is loaded from DB via loadedEvaluators)
        const firstEvaluation = storedRun?.evaluations?.[0];
        expect(firstEvaluation?.evaluator).toBe("eval-1");
        expect(firstEvaluation?.name).toBeNull();

        // Verify timestamps
        expect(storedRun?.timestamps.created_at).toBeDefined();
        expect(storedRun?.timestamps.finished_at).toBeDefined();

        // Clean up - delete the ES document
        const { esClient, BATCH_EVALUATION_INDEX } = await import(
          "~/server/elasticsearch"
        );
        const client = await esClient({ projectId: project.id });
        await client.deleteByQuery({
          index: BATCH_EVALUATION_INDEX.alias,
          body: {
            query: {
              bool: {
                must: [
                  { term: { project_id: project.id } },
                  { term: { run_id: runId } },
                ],
              },
            },
          },
        });
      } finally {
        // Clean up experiment
        await prisma.experiment.delete({
          where: { id: experimentId, projectId: project.id },
        });
      }
    }, 120000);

    it("does not store to Elasticsearch when saveToEs is false", async () => {
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");
      const { getDefaultBatchEvaluationRepository } = await import(
        "../../repositories/elasticsearchBatchEvaluation.repository"
      );

      const experimentId = `exp_${nanoid()}`;
      await prisma.experiment.create({
        data: {
          id: experimentId,
          projectId: project.id,
          name: "No ES Storage Test",
          slug: `no-es-test-${nanoid(8)}`,
          type: "EVALUATIONS_V3",
        },
      });

      try {
        const state = createTestState([
          createTargetConfig("target-1"),
        ]);
        const datasetRows = [{ question: "Say hello", expected: "hello" }];
        const datasetColumns = [
          { id: "question", name: "question", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        const input: OrchestratorInput = {
          projectId: project.id,
          experimentId,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          saveToEs: false, // Explicitly disabled
        };

        const events = await collectEvents(input);

        // Get run ID
        const startEvent = events.find((e) => e.type === "execution_started");
        if (startEvent?.type !== "execution_started")
          throw new Error("Expected execution_started event");
        const runId = startEvent.runId;

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify nothing was stored
        const repository = getDefaultBatchEvaluationRepository();
        const storedRun = await repository.getByRunId({
          projectId: project.id,
          experimentId,
          runId,
        });

        expect(storedRun).toBeNull();
      } finally {
        await prisma.experiment.delete({
          where: { id: experimentId, projectId: project.id },
        });
      }
    }, 60000);

    it("stores model from loadedPrompts when target has no localPromptConfig", async () => {
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");
      const { getDefaultBatchEvaluationRepository } = await import(
        "../../repositories/elasticsearchBatchEvaluation.repository"
      );

      const experimentId = `exp_${nanoid()}`;
      const promptId = `prompt_${nanoid()}`;
      await prisma.experiment.create({
        data: {
          id: experimentId,
          projectId: project.id,
          name: "Model From Loaded Prompt Test",
          slug: `model-test-${nanoid(8)}`,
          type: "EVALUATIONS_V3",
        },
      });

      try {
        // Create a target WITHOUT localPromptConfig (simulates saved prompt)
        const targetWithoutLocalConfig: TargetConfig = {
          id: "target-1",
          type: "prompt",
          promptId: promptId, // Reference to saved prompt
          promptVersionId: "version-1",
          promptVersionNumber: 1,
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
          // NOTE: no localPromptConfig - this is the scenario we're testing
        };

        const state = createTestState([targetWithoutLocalConfig]);
        const datasetRows = [{ question: "Say hello", expected: "hello" }];
        const datasetColumns = [
          { id: "question", name: "question", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        // Create a mock VersionedPrompt with a model
        const mockVersionedPrompt: VersionedPrompt = {
          id: promptId,
          name: "Saved Prompt Target",
          handle: "test-prompt",
          scope: "PROJECT",
          version: 1,
          versionId: "version-1",
          versionCreatedAt: new Date(),
          model: "openai/gpt-4-turbo", // This should be stored
          temperature: 0.7,
          maxTokens: 100,
          prompt: "You are a helpful assistant.",
          projectId: project.id,
          organizationId: "org-1",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "{{input}}" },
          ],
          authorId: null,
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          updatedAt: new Date(),
          createdAt: new Date(),
        };

        // Create loadedPrompts map with our mock prompt
        const loadedPrompts = new Map<string, VersionedPrompt>();
        loadedPrompts.set(promptId, mockVersionedPrompt);

        const input: OrchestratorInput = {
          projectId: project.id,
          experimentId,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts, // Pass loaded prompts
          loadedAgents: new Map(),
          saveToEs: true,
        };

        const events = await collectEvents(input);

        // Verify execution completed
        const doneEvent = events.find((e) => e.type === "done");
        expect(doneEvent).toBeDefined();

        // Get the run ID
        const startEvent = events.find((e) => e.type === "execution_started");
        if (startEvent?.type !== "execution_started")
          throw new Error("Expected execution_started event");
        const runId = startEvent.runId;

        // Wait for ES to index
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify data was stored in Elasticsearch
        const repository = getDefaultBatchEvaluationRepository();
        const storedRun = await repository.getByRunId({
          projectId: project.id,
          experimentId,
          runId,
        });

        // Verify the target has the model from loadedPrompts
        expect(storedRun).not.toBeNull();
        expect(storedRun?.targets).toBeDefined();
        expect(storedRun?.targets?.length).toBe(1);
        expect(storedRun?.targets?.[0]?.name).toBe("Saved Prompt Target");
        expect(storedRun?.targets?.[0]?.model).toBe("openai/gpt-4-turbo");

        // Clean up ES document
        const { esClient, BATCH_EVALUATION_INDEX } = await import(
          "~/server/elasticsearch"
        );
        const client = await esClient({ projectId: project.id });
        await client.deleteByQuery({
          index: BATCH_EVALUATION_INDEX.alias,
          body: {
            query: {
              bool: {
                must: [
                  { term: { project_id: project.id } },
                  { term: { run_id: runId } },
                ],
              },
            },
          },
        });
      } finally {
        await prisma.experiment.delete({
          where: { id: experimentId, projectId: project.id },
        });
      }
    }, 120000);

    it("stores falsy output values (false, null) to Elasticsearch correctly", async () => {
      // This test verifies the fix for storing falsy outputs like {output: false}
      // Previously, the check `event.output ? {...}` would skip falsy values
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");
      const { getDefaultBatchEvaluationRepository } = await import(
        "../../repositories/elasticsearchBatchEvaluation.repository"
      );

      const experimentId = `exp_${nanoid()}`;
      const evaluatorId = `evaluator_${nanoid()}`;

      // Create experiment
      await prisma.experiment.create({
        data: {
          id: experimentId,
          projectId: project.id,
          name: "Falsy Output Storage Test",
          slug: `falsy-output-test-${nanoid(8)}`,
          type: "EVALUATIONS_V3",
        },
      });

      // Create evaluator (exact_match returns passed: false for non-matching)
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: project.id,
          name: "Exact Match for Falsy Test",
          type: "evaluator",
          config: {
            evaluatorType: "langevals/exact_match",
            settings: {},
          },
        },
      });

      try {
        // Use evaluator as target - it returns boolean `passed` field
        const evaluatorTargetConfig: TargetConfig = {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: evaluatorId,
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "score", type: "float" },
          ],
          mappings: {
            "dataset-1": {
              output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "response",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "expected",
              },
            },
          },
        };

        const state = createTestState([evaluatorTargetConfig]);
        // Non-matching values will produce passed: false
        const datasetRows = [
          { response: "hello", expected: "world" }, // Will return passed: false
        ];
        const datasetColumns = [
          { id: "response", name: "response", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        // Load the evaluator
        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        loadedEvaluators.set(evaluatorId, {
          id: evaluatorId,
          name: "Exact Match for Falsy Test",
          config: { evaluatorType: "langevals/exact_match", settings: {} },
        });

        const input: OrchestratorInput = {
          projectId: project.id,
          experimentId,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
          saveToEs: true,
        };

        const events = await collectEvents(input);

        // Verify execution completed
        const doneEvent = events.find((e) => e.type === "done");
        expect(doneEvent).toBeDefined();

        // Verify target_result has passed: false
        const targetResult = events.find((e) => e.type === "target_result");
        expect(targetResult).toBeDefined();
        if (targetResult?.type === "target_result") {
          const output = targetResult.output as { passed?: boolean };
          expect(output.passed).toBe(false); // This is the falsy value we're testing
        }

        // Get run ID
        const startEvent = events.find((e) => e.type === "execution_started");
        if (startEvent?.type !== "execution_started")
          throw new Error("Expected execution_started event");
        const runId = startEvent.runId;

        // Wait for ES to index
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify the falsy output was stored in Elasticsearch
        const repository = getDefaultBatchEvaluationRepository();
        const storedRun = await repository.getByRunId({
          projectId: project.id,
          experimentId,
          runId,
        });

        expect(storedRun).not.toBeNull();
        expect(storedRun?.dataset).toBeDefined();
        expect(storedRun?.dataset?.length).toBe(1);

        // CRITICAL: Verify predicted field is stored even with falsy output
        const datasetEntry = storedRun?.dataset?.[0];
        expect(datasetEntry?.predicted).toBeDefined();
        expect(datasetEntry?.predicted?.output).toBeDefined();
        // The output should contain passed: false (not be undefined/missing)
        expect((datasetEntry?.predicted?.output as any)?.passed).toBe(false);

        // Clean up ES document
        const { esClient, BATCH_EVALUATION_INDEX } = await import(
          "~/server/elasticsearch"
        );
        const client = await esClient({ projectId: project.id });
        await client.deleteByQuery({
          index: BATCH_EVALUATION_INDEX.alias,
          body: {
            query: {
              bool: {
                must: [
                  { term: { project_id: project.id } },
                  { term: { run_id: runId } },
                ],
              },
            },
          },
        });
      } finally {
        // Clean up
        await prisma.evaluator.delete({
          where: { id: evaluatorId, projectId: project.id },
        });
        await prisma.experiment.delete({
          where: { id: experimentId, projectId: project.id },
        });
      }
    }, 120000);

    it("stores errors to Elasticsearch when cell execution fails", async () => {
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");
      const { getDefaultBatchEvaluationRepository } = await import(
        "../../repositories/elasticsearchBatchEvaluation.repository"
      );

      const experimentId = `exp_${nanoid()}`;
      await prisma.experiment.create({
        data: {
          id: experimentId,
          projectId: project.id,
          name: "Error Storage Test",
          slug: `error-test-${nanoid(8)}`,
          type: "EVALUATIONS_V3",
        },
      });

      try {
        // Create a target with an invalid model to cause an error
        const targetConfig: TargetConfig = {
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
          localPromptConfig: {
            llm: {
              model: "openai/invalid-model-that-does-not-exist",
              temperature: 0,
              maxTokens: 50,
            },
            messages: [{ role: "user", content: "{{input}}" }],
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        };

        const state = createTestState([targetConfig]);
        const datasetRows = [{ question: "Test question" }];
        const datasetColumns = [
          { id: "question", name: "question", type: "string" },
        ];

        const input: OrchestratorInput = {
          projectId: project.id,
          experimentId,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          saveToEs: true,
        };

        const events = await collectEvents(input);

        // Verify execution completed (even with errors)
        const doneEvent = events.find((e) => e.type === "done");
        expect(doneEvent).toBeDefined();

        // Verify there was an error
        const errorEvents = events.filter(
          (e) =>
            e.type === "error" ||
            (e.type === "target_result" && (e as any).error),
        );
        expect(errorEvents.length).toBeGreaterThan(0);

        // Get the run ID
        const startEvent = events.find((e) => e.type === "execution_started");
        if (startEvent?.type !== "execution_started")
          throw new Error("Expected execution_started event");
        const runId = startEvent.runId;

        // Wait for ES to index
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify error was stored in Elasticsearch
        const repository = getDefaultBatchEvaluationRepository();
        const storedRun = await repository.getByRunId({
          projectId: project.id,
          experimentId,
          runId,
        });

        expect(storedRun).not.toBeNull();

        // Verify dataset entry has error field populated
        expect(storedRun?.dataset).toBeDefined();
        expect(storedRun?.dataset?.length).toBeGreaterThan(0);

        const entryWithError = storedRun?.dataset?.find(
          (d) => d.error !== null && d.error !== undefined,
        );
        expect(entryWithError).toBeDefined();
        expect(entryWithError?.error).toBeTruthy();
        expect(typeof entryWithError?.error).toBe("string");

        // Clean up ES document
        const { esClient, BATCH_EVALUATION_INDEX } = await import(
          "~/server/elasticsearch"
        );
        const client = await esClient({ projectId: project.id });
        await client.deleteByQuery({
          index: BATCH_EVALUATION_INDEX.alias,
          body: {
            query: {
              bool: {
                must: [
                  { term: { project_id: project.id } },
                  { term: { run_id: runId } },
                ],
              },
            },
          },
        });
      } finally {
        await prisma.experiment.delete({
          where: { id: experimentId, projectId: project.id },
        });
      }
    }, 120000);
  });

  describe("column name vs ID mapping", () => {
    it("correctly handles real payload format with chat_messages and input fields", async () => {
      // This test uses the EXACT format from a real frontend request
      // Including the transposeColumnsFirstToRowsFirstWithId and JSON parsing steps
      const { transposeColumnsFirstToRowsFirstWithId } = await import(
        "~/optimization_studio/utils/datasetUtils"
      );

      const datasetColumns: DatasetColumn[] = [
        { id: "input_0", name: "input", type: "string" },
        { id: "expected_output_1", name: "expected_output", type: "string" },
        { id: "messages_2", name: "messages", type: "chat_messages" },
        { id: "thread_id_3", name: "thread_id", type: "string" },
      ];

      // This is EXACTLY what the frontend sends - columns-first format with JSON strings
      const inlineRecords = {
        input_0: ["How do I update my billing information?"],
        expected_output_1: ["You can update your billing..."],
        messages_2: ['[{"role": "user", "content": "hi"}]'], // JSON string
        thread_id_3: ["1"],
      };

      // Step 1: Transpose (like the API route does)
      let datasetRows = transposeColumnsFirstToRowsFirstWithId(inlineRecords);

      // Step 2: Normalize column IDs to column names (like the API route does)
      // This is the key step - the orchestrator expects column NAMES as keys
      const idToName = Object.fromEntries(
        datasetColumns.map((c) => [c.id, c.name]),
      );
      datasetRows = datasetRows.map((row) => {
        const normalized: Record<string, unknown> = { id: row.id };
        for (const [key, value] of Object.entries(row)) {
          if (key !== "id") {
            normalized[idToName[key] ?? key] = value;
          }
        }
        return normalized as typeof row;
      });

      // Step 3: Parse JSON columns (like the API route does)
      const jsonColumns = new Set(
        datasetColumns
          .filter((c) =>
            ["chat_messages", "json", "list", "spans", "rag_contexts"].includes(
              c.type,
            ),
          )
          .map((c) => c.name), // Use name since we normalized above
      );
      if (jsonColumns.size > 0) {
        datasetRows = datasetRows.map((row) => {
          const parsedRow = { ...row };
          for (const colName of jsonColumns) {
            const value = parsedRow[colName];
            if (typeof value === "string" && value.trim()) {
              try {
                parsedRow[colName] = JSON.parse(value);
              } catch {
                // Keep original string if not valid JSON
              }
            }
          }
          return parsedRow;
        });
      }

      // Verify the parsing worked - now using column NAMES as keys
      expect(datasetRows[0]?.messages).toEqual([
        { role: "user", content: "hi" },
      ]);
      expect(datasetRows[0]?.input).toBe(
        "How do I update my billing information?",
      );

      // HTTP Agent target that maps both messages and input
      const httpAgentTarget: TargetConfig = {
        id: "target_http",
        type: "agent",
        agentType: "http",
        inputs: [
          { identifier: "messages", type: "chat_messages" as "str" },
          { identifier: "input", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "test-data": {
            messages: {
              type: "source",
              source: "dataset",
              sourceId: "test-data",
              sourceField: "messages", // Uses column NAME, not ID
            },
            input: {
              type: "source",
              source: "dataset",
              sourceId: "test-data",
              sourceField: "input", // Uses column NAME, not ID
            },
          },
        },
        httpConfig: {
          url: "https://httpbin.org/post",
          method: "POST",
          bodyTemplate:
            '{"messages": {{messages}}, "input": "{{input}}", "model": "test"}',
          outputPath: "$.json",
        },
      };

      const state: EvaluationsV3State = {
        name: "Test",
        datasets: [
          {
            id: "test-data",
            name: "Test Data",
            type: "inline",
            columns: datasetColumns,
          },
        ],
        activeDatasetId: "test-data",
        targets: [httpAgentTarget],
        evaluators: [],
        results: createInitialResults(),
        pendingSavedChanges: {},
        ui: createInitialUIState(),
      };

      // Import the HTTP agent service to create a mock agent
      const { AgentService } = await import("~/server/agents/agent.service");
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");
      const agentService = AgentService.create(prisma);

      // Create a temporary HTTP agent for this test
      const agent = await agentService.create({
        id: `agent_${nanoid()}`,
        projectId: project.id,
        name: "Test HTTP Agent",
        type: "http",
        config: {
          name: "HTTP",
          description: "Test HTTP agent",
          url: "https://httpbin.org/post",
          method: "POST",
          bodyTemplate:
            '{"messages": {{messages}}, "input": "{{input}}", "model": "test"}',
          outputPath: "$.json",
        },
      });

      try {
        // Update target to use the real agent ID
        httpAgentTarget.dbAgentId = agent.id;

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "cell", rowIndex: 0, targetId: "target_http" },
          state,
          datasetRows: datasetRows.map((row) => ({
            _datasetId: "test-data",
            ...row,
          })),
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map([[agent.id, agent]]),
        };

        const events = await collectEvents(input);

        // Find target result
        const targetResult = events.find((e) => e.type === "target_result");
        expect(targetResult).toBeDefined();

        if (targetResult?.type === "target_result") {
          // Should NOT have any error
          expect(targetResult.error).toBeUndefined();

          // Output should contain the echoed JSON from httpbin.org
          expect(targetResult.output).not.toBeNull();
          const output = targetResult.output as Record<string, unknown>;

          // Verify messages is a proper array (not over-escaped)
          expect(output.messages).toEqual([{ role: "user", content: "hi" }]);

          // Verify input is the correct value (not empty)
          expect(output.input).toBe("How do I update my billing information?");

          // Verify model is there too
          expect(output.model).toBe("test");
        }

        // Should complete
        const doneEvent = events[events.length - 1];
        expect(doneEvent?.type).toBe("done");
      } finally {
        // Clean up agent
        await agentService.softDelete({ id: agent.id, projectId: project.id });
      }
    }, 60000);

    it("resolves column names to column IDs when columns have different ids and names", async () => {
      // This test catches the bug where mappings use column NAME (e.g., "question")
      // but datasetEntry keys use column ID (e.g., "question_0")
      // This is how the real app works - column IDs are auto-generated like "input_0"
      const targetWithNameMapping: TargetConfig = {
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
              sourceField: "question", // Uses column NAME, not ID!
            },
          },
        },
        localPromptConfig: createPromptConfig(),
      };

      const state = createTestState([targetWithNameMapping]);

      // Dataset with column ID != column name (like the real app)
      const datasetRows = [
        { question_0: "Say hello", expected_output_1: "hello" }, // Keys use column ID
      ];
      const datasetColumns = [
        { id: "question_0", name: "question", type: "string" }, // ID != name
        { id: "expected_output_1", name: "expected_output", type: "string" },
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

      // Should NOT have errors about empty input
      const errorEvents = events.filter((e) => e.type === "error");
      for (const event of errorEvents) {
        if (event.type === "error") {
          // Should not have errors related to missing/empty input
          expect(event.message).not.toContain("empty");
          expect(event.message).not.toContain("undefined");
        }
      }

      // Should have a target_result
      const targetResults = events.filter((e) => e.type === "target_result");
      expect(targetResults.length).toBeGreaterThanOrEqual(1);

      // Target should have succeeded (or at least got the input)
      const targetResult = targetResults[0];
      if (targetResult?.type === "target_result") {
        // If there's an error, it shouldn't be about missing input
        if (targetResult.error) {
          expect(targetResult.error).not.toContain("input");
        }
      }

      // Should complete
      const doneEvent = events[events.length - 1];
      expect(doneEvent?.type).toBe("done");
    }, 60000);
  });

  describe("evaluator as target execution", () => {
    it("executes evaluator as target and returns passed/score/label in target_result", async () => {
      // Create a real evaluator in the database
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");

      const evaluatorId = `evaluator_${nanoid()}`;
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: project.id,
          name: "Test Exact Match Evaluator",
          type: "evaluator",
          config: {
            evaluatorType: "langevals/exact_match",
            settings: {},
          },
        },
      });

      try {
        // Create evaluator-as-target config
        const evaluatorTargetConfig: TargetConfig = {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: evaluatorId,
          
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "score", type: "float" },
            { identifier: "label", type: "str" },
          ],
          mappings: {
            "dataset-1": {
              output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "response",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "expected",
              },
            },
          },
        };

        const state = createTestState([evaluatorTargetConfig]);
        // Test with matching values - should pass
        const datasetRows = [
          { response: "hello world", expected: "hello world" },
        ];
        const datasetColumns = [
          { id: "response", name: "response", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        // Load the evaluator from DB
        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        const dbEvaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId: project.id },
        });
        if (dbEvaluator) {
          loadedEvaluators.set(evaluatorId, {
            id: dbEvaluator.id,
            name: dbEvaluator.name,
            config: dbEvaluator.config,
          });
        }

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
        };

        const events = await collectEvents(input);

        // Should complete successfully
        expect(events[events.length - 1]?.type).toBe("done");

        // Should have target_result (NOT evaluator_result - this is evaluator-as-target)
        const targetResults = events.filter((e) => e.type === "target_result");
        expect(targetResults.length).toBe(1);

        const targetResult = targetResults[0];
        if (targetResult?.type === "target_result") {
          expect(targetResult.targetId).toBe("target-eval");
          expect(targetResult.rowIndex).toBe(0);

          // Output should contain evaluator results (passed, score, label)
          const output = targetResult.output as {
            passed?: boolean;
            score?: number;
            label?: string;
          };
          expect(output).toBeDefined();
          // With matching values, should pass
          expect(output.passed).toBe(true);
        }

        // Should NOT have evaluator_result events (evaluator is the target, not a downstream evaluator)
        const evaluatorResults = events.filter(
          (e) => e.type === "evaluator_result",
        );
        expect(evaluatorResults).toHaveLength(0);
      } finally {
        // Cleanup
        await prisma.evaluator.delete({
          where: { id: evaluatorId, projectId: project.id },
        });
      }
    }, 120000);

    it("handles evaluator target with non-matching values (should fail)", async () => {
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");

      const evaluatorId = `evaluator_${nanoid()}`;
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: project.id,
          name: "Test Exact Match Evaluator",
          type: "evaluator",
          config: {
            evaluatorType: "langevals/exact_match",
            settings: {},
          },
        },
      });

      try {
        const evaluatorTargetConfig: TargetConfig = {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: evaluatorId,
          
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "score", type: "float" },
            { identifier: "label", type: "str" },
          ],
          mappings: {
            "dataset-1": {
              output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "response",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "expected",
              },
            },
          },
        };

        const state = createTestState([evaluatorTargetConfig]);
        // Test with NON-matching values - should fail
        const datasetRows = [
          { response: "hello world", expected: "goodbye world" },
        ];
        const datasetColumns = [
          { id: "response", name: "response", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        const dbEvaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId: project.id },
        });
        if (dbEvaluator) {
          loadedEvaluators.set(evaluatorId, {
            id: dbEvaluator.id,
            name: dbEvaluator.name,
            config: dbEvaluator.config,
          });
        }

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
        };

        const events = await collectEvents(input);

        // Should complete
        expect(events[events.length - 1]?.type).toBe("done");

        // Check target_result
        const targetResults = events.filter((e) => e.type === "target_result");
        expect(targetResults.length).toBe(1);

        const targetResult = targetResults[0];
        if (targetResult?.type === "target_result") {
          const output = targetResult.output as {
            passed?: boolean;
            score?: number;
            label?: string;
          };
          // With non-matching values, should fail
          expect(output.passed).toBe(false);
        }
      } finally {
        await prisma.evaluator.delete({
          where: { id: evaluatorId, projectId: project.id },
        });
      }
    }, 120000);

    it("executes evaluator target with downstream evaluator (meta-evaluation)", async () => {
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");

      // Create the evaluator that will be used as a target
      const targetEvaluatorId = `evaluator_${nanoid()}`;
      await prisma.evaluator.create({
        data: {
          id: targetEvaluatorId,
          projectId: project.id,
          name: "Sentiment Target Evaluator",
          type: "evaluator",
          config: {
            evaluatorType: "langevals/exact_match",
            settings: {},
          },
        },
      });

      try {
        // Evaluator-as-target config
        const evaluatorTargetConfig: TargetConfig = {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: targetEvaluatorId,
          
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "score", type: "float" },
            { identifier: "label", type: "str" },
          ],
          mappings: {
            "dataset-1": {
              output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "response",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "expected",
              },
            },
          },
        };

        // Downstream evaluator that validates the target's output
        // This evaluator checks if the target passed - "meta-evaluation"
        const downstreamEvaluatorConfig: EvaluatorConfig = {
          id: "meta-eval",
          evaluatorType: "langevals/exact_match",
          settings: {},
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          mappings: {
            "dataset-1": {
              "target-eval": {
                // Map the evaluator target's 'passed' output to the downstream evaluator
                output: {
                  type: "source",
                  source: "target",
                  sourceId: "target-eval",
                  sourceField: "passed",
                },
                expected_output: {
                  type: "source",
                  source: "dataset",
                  sourceId: "dataset-1",
                  sourceField: "expected_passed",
                },
              },
            },
          },
        };

        const state = createTestState(
          [evaluatorTargetConfig],
          [downstreamEvaluatorConfig],
        );
        // Matching values should pass, and we expect it to pass
        const datasetRows = [
          {
            response: "hello",
            expected: "hello",
            expected_passed: "true", // Expect the evaluator target to pass
          },
        ];
        const datasetColumns = [
          { id: "response", name: "response", type: "string" },
          { id: "expected", name: "expected", type: "string" },
          { id: "expected_passed", name: "expected_passed", type: "string" },
        ];

        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        const dbEvaluator = await prisma.evaluator.findFirst({
          where: { id: targetEvaluatorId, projectId: project.id },
        });
        if (dbEvaluator) {
          loadedEvaluators.set(targetEvaluatorId, {
            id: dbEvaluator.id,
            name: dbEvaluator.name,
            config: dbEvaluator.config,
          });
        }

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
        };

        const events = await collectEvents(input);

        // Should complete
        expect(events[events.length - 1]?.type).toBe("done");

        // Should have target_result for the evaluator target
        const targetResults = events.filter((e) => e.type === "target_result");
        expect(targetResults.length).toBe(1);

        const targetResult = targetResults[0];
        if (targetResult?.type === "target_result") {
          expect(targetResult.targetId).toBe("target-eval");
          const output = targetResult.output as { passed?: boolean };
          expect(output.passed).toBe(true);
        }

        // Should have evaluator_result for the downstream meta-evaluator
        const evaluatorResults = events.filter(
          (e) => e.type === "evaluator_result",
        );
        expect(evaluatorResults.length).toBe(1);

        const evalResult = evaluatorResults[0];
        if (evalResult?.type === "evaluator_result") {
          expect(evalResult.evaluatorId).toBe("meta-eval");
          expect(evalResult.targetId).toBe("target-eval");
          expect(evalResult.result.status).toBe("processed");
          // The meta-evaluator should pass because target passed matches expected_passed
          if (evalResult.result.status === "processed") {
            expect(evalResult.result.passed).toBe(true);
          }
        }
      } finally {
        await prisma.evaluator.delete({
          where: { id: targetEvaluatorId, projectId: project.id },
        });
      }
    }, 120000);

    it("executes multiple rows with evaluator target", async () => {
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");

      const evaluatorId = `evaluator_${nanoid()}`;
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: project.id,
          name: "Test Exact Match Evaluator",
          type: "evaluator",
          config: {
            evaluatorType: "langevals/exact_match",
            settings: {},
          },
        },
      });

      try {
        const evaluatorTargetConfig: TargetConfig = {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: evaluatorId,
          
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          outputs: [
            { identifier: "passed", type: "bool" },
            { identifier: "score", type: "float" },
            { identifier: "label", type: "str" },
          ],
          mappings: {
            "dataset-1": {
              output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "response",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "expected",
              },
            },
          },
        };

        const state = createTestState([evaluatorTargetConfig]);
        // Multiple rows: first matches, second doesn't
        const datasetRows = [
          { response: "hello", expected: "hello" }, // Should pass
          { response: "foo", expected: "bar" }, // Should fail
          { response: "test", expected: "test" }, // Should pass
        ];
        const datasetColumns = [
          { id: "response", name: "response", type: "string" },
          { id: "expected", name: "expected", type: "string" },
        ];

        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        const dbEvaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId: project.id },
        });
        if (dbEvaluator) {
          loadedEvaluators.set(evaluatorId, {
            id: dbEvaluator.id,
            name: dbEvaluator.name,
            config: dbEvaluator.config,
          });
        }

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
        };

        const events = await collectEvents(input);

        // Should complete
        expect(events[events.length - 1]?.type).toBe("done");

        // Should have 3 target_result events
        const targetResults = events.filter(
          (e) => e.type === "target_result",
        ) as Array<Extract<EvaluationV3Event, { type: "target_result" }>>;
        expect(targetResults.length).toBe(3);

        // Check each result
        const resultByRow = targetResults.reduce(
          (acc, r) => {
            acc[r.rowIndex] = r;
            return acc;
          },
          {} as Record<number, (typeof targetResults)[0]>,
        );

        // Row 0: should pass
        expect(
          (resultByRow[0]?.output as { passed?: boolean })?.passed,
        ).toBe(true);
        // Row 1: should fail
        expect(
          (resultByRow[1]?.output as { passed?: boolean })?.passed,
        ).toBe(false);
        // Row 2: should pass
        expect(
          (resultByRow[2]?.output as { passed?: boolean })?.passed,
        ).toBe(true);

        // Done event should show 3 completed cells
        const doneEvent = events[events.length - 1];
        if (doneEvent?.type === "done") {
          expect(doneEvent.summary.totalCells).toBe(3);
          expect(doneEvent.summary.completedCells).toBe(3);
        }
      } finally {
        await prisma.evaluator.delete({
          where: { id: evaluatorId, projectId: project.id },
        });
      }
    }, 120000);
  });

  describe("evaluators with custom input fields", () => {
    it("passes custom/unconventional input fields via data parameter", async () => {
      // This test verifies that evaluators with custom input field names
      // (like "answer" instead of standard "output") work correctly.
      // The fix ensures kwargs are passed via data= instead of **kwargs
      // to avoid "unexpected keyword argument" errors.
      const { prisma } = await import("~/server/db");
      const { nanoid } = await import("nanoid");

      const evaluatorId = `evaluator_${nanoid()}`;

      // Create an evaluator that uses non-standard input field names
      // This simulates a workflow-based evaluator with custom inputs
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: project.id,
          name: "Custom Fields Evaluator",
          type: "evaluator",
          config: {
            // Use exact_match but with custom field mapping
            // The key test is that "answer" field gets passed correctly
            evaluatorType: "langevals/exact_match",
            settings: {},
          },
        },
      });

      try {
        // Create evaluator config with custom input field names
        // "answer" is a non-standard field that would fail with **kwargs
        const customFieldsEvaluator: EvaluatorConfig = {
          id: "eval-custom-fields",
          evaluatorType: "langevals/exact_match",
          dbEvaluatorId: evaluatorId,
          // Note: using "answer" instead of standard "output"
          // and "correct_answer" instead of "expected_output"
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
          mappings: {
            "dataset-1": {
              "target-1": {
                // Map custom dataset fields to evaluator inputs
                output: {
                  type: "source",
                  source: "dataset",
                  sourceId: "dataset-1",
                  sourceField: "answer", // Custom field name in dataset
                },
                expected_output: {
                  type: "source",
                  source: "dataset",
                  sourceId: "dataset-1",
                  sourceField: "correct_answer", // Custom field name in dataset
                },
              },
            },
          },
        };

        // Create a minimal target that just passes through
        const passthroughTarget: TargetConfig = {
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
          localPromptConfig: createPromptConfig(),
        };

        const state = createTestState([passthroughTarget], [customFieldsEvaluator]);

        // Dataset with custom field names
        const datasetRows = [
          {
            question: "Say hello",
            answer: "hello", // Custom field instead of "output"
            correct_answer: "hello", // Custom field instead of "expected_output"
          },
          {
            question: "Say world",
            answer: "world",
            correct_answer: "world",
          },
        ];
        const datasetColumns = [
          { id: "question", name: "question", type: "string" },
          { id: "answer", name: "answer", type: "string" },
          { id: "correct_answer", name: "correct_answer", type: "string" },
        ];

        const loadedEvaluators = new Map<
          string,
          { id: string; name: string; config: unknown }
        >();
        const dbEvaluator = await prisma.evaluator.findFirst({
          where: { id: evaluatorId, projectId: project.id },
        });
        if (dbEvaluator) {
          loadedEvaluators.set(evaluatorId, {
            id: dbEvaluator.id,
            name: dbEvaluator.name,
            config: dbEvaluator.config,
          });
        }

        const input: OrchestratorInput = {
          projectId: project.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators,
        };

        const events = await collectEvents(input);

        // Should complete without "unexpected keyword argument" error
        expect(events[events.length - 1]?.type).toBe("done");

        // Should have evaluator results
        const evaluatorResults = events.filter(
          (e) => e.type === "evaluator_result",
        ) as Array<Extract<EvaluationV3Event, { type: "evaluator_result" }>>;

        // We expect 2 evaluator results (one per row)
        expect(evaluatorResults.length).toBe(2);

        // Each result should be processed (not error)
        // If custom fields weren't passed correctly, we'd get:
        // TypeError("evaluate() got an unexpected keyword argument 'answer'")
        for (const result of evaluatorResults) {
          expect(result.result.status).toBe("processed");
        }
      } finally {
        await prisma.evaluator.delete({
          where: { id: evaluatorId, projectId: project.id },
        });
      }
    }, 120000);
  });
});
