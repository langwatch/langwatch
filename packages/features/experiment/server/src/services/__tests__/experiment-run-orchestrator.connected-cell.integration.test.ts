/**
 * Tests executeConnectedCell: running a connected agent as a workbench column.
 *
 * The relay dispatcher is injected, so the turn is scripted rather than sent
 * to a real process, and the studio port is a fake that replays scripted
 * component events, so the grading evaluators run their mapping logic without
 * a live NLP service. (The platform version mocked three `~/`-rooted modules;
 * the cell takes its studio boundary as a port now, so the fake is passed in.)
 *
 * @see specs/experiments-v3/connected-agent-target.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatorConfig } from "@langwatch/experiment-contract";
import type { StudioServerEvent, WorkflowService } from "@langwatch/workflow-contract";

const scripted = vi.hoisted(() => ({
  component: [] as StudioServerEvent[],
  dispatched: [] as Array<{ type: string; payload: Record<string, any> }>,
}));

import type { EvaluationsV3State, TargetConfig } from "@langwatch/experiment-contract";
import { createInitialResults, createInitialUIState } from "@langwatch/experiment-contract";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { CallOutcome } from "@langwatch/agent-contract";
import { AgentBusyError, AgentOfflineError } from "@langwatch/agent-contract";
import {
  type ConnectedDispatch,
  executeConnectedCell,
  type ExperimentRunPorts,
  type OrchestratorInput,
  runOrchestrator,
} from "../experiment-run-orchestrator.service";
import type { EvaluationV3Event, ExecutionCell } from "@langwatch/experiment-contract";

/**
 * The studio boundary the grading evaluators reach, scripted rather than dialled.
 *
 * `postEvent` records what was sent and replays whatever the case put in
 * `scripted.component`, which is what the platform test's module mock did.
 */
const ports = {
  studio: {
    postEvent: async ({
      event,
      onEvent,
    }: {
      event: { type: string; payload: Record<string, any> };
      onEvent: (event: StudioServerEvent) => void;
    }) => {
      scripted.dispatched.push(event);
      for (const serverEvent of scripted.component) onEvent(serverEvent);
    },
  },
} as unknown as ExperimentRunPorts;

/** The enrichment the run does before posting: identity, in a test. */
const workflows = {
  enrichStudioEvent: async ({ event }: { event: unknown }) => event,
  prepareStudioEvent: async ({ event }: { event: unknown }) => event,
} as unknown as WorkflowService;

const agent = {
  id: "agent_1",
  name: "support-agent",
  type: "connected",
  environment: "production",
  config: {
    parameters: [
      { name: "model", type: "string", options: ["gpt-5", "gpt-5-mini"] },
      { name: "plan", type: "string" },
    ],
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
  },
} as unknown as TypedAgent;

const answered = (output: string): CallOutcome => ({
  output,
  instance: {
    instanceId: "inst_1",
    hostname: "laptop",
    label: null,
  },
  durationMs: 1200,
});

const makeCell = (overrides?: Partial<ExecutionCell>): ExecutionCell => ({
  rowIndex: 0,
  targetId: "connected-target",
  targetConfig: {
    id: "connected-target",
    type: "agent",
    agentType: "connected",
    dbAgentId: "agent_1",
    inputs: [
      { identifier: "input", type: "str" },
      { identifier: "model", type: "str", optional: true },
    ],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      "dataset-1": {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "dataset-1",
          sourceField: "question",
        },
        model: { type: "value", value: "gpt-5" },
      },
    },
  },
  evaluatorConfigs: [],
  datasetEntry: {
    _datasetId: "dataset-1",
    question: "How do I return a broken item?",
  },
  ...overrides,
});

/** A grading evaluator attached to the column, reading its output. */
const gradingEvaluator: EvaluatorConfig = {
  id: "eval-grading",
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-eval-1",
  inputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "dataset-1": {
      "connected-target": {
        output: {
          type: "source",
          source: "target",
          sourceId: "connected-target",
          sourceField: "output",
        },
      },
    },
  },
};

const run = async ({
  cell,
  dispatch,
  now,
}: {
  cell: ExecutionCell;
  dispatch: ConnectedDispatch;
  /** A clock the test moves by hand, so a cell duration is exact. */
  now?: () => number;
}): Promise<EvaluationV3Event[]> => {
  const events: EvaluationV3Event[] = [];
  for await (const event of executeConnectedCell({
    cell,
    projectId: "p1",
    agent,
    datasetColumns: [{ id: "col_1", name: "question", type: "string" }],
    dispatch,
    sleep: async () => undefined,
    ports,
    workflows,
    ...(now ? { now } : {}),
  })) {
    events.push(event);
  }
  return events;
};

beforeEach(() => {
  scripted.component = [];
  scripted.dispatched = [];
});

describe("given a connected agent column", () => {
  describe("when the row runs", () => {
    /** @scenario "The column reads the dataset row and answers" */
    it("sends the mapped row and writes the answer in the cell", async () => {
      const dispatch = vi.fn<ConnectedDispatch>(async () => answered("Open a return request."));

      // Every read of the clock is 1200ms later, so the duration the row
      // reports is exact.
      let clock = 0;
      const events = await run({
        cell: makeCell(),
        dispatch,
        now: () => (clock += 1200),
      });

      const call = dispatch.mock.calls[0]![0];
      expect(call.call.messages).toEqual([
        { role: "user", content: "How do I return a broken item?" },
      ]);
      expect(call.call.params).toEqual({ model: "gpt-5" });
      expect(call.agent.id).toBe("agent_1");

      expect(events.map((event) => event.type)).toEqual(["cell_started", "target_result"]);
      const result = events[1] as Extract<EvaluationV3Event, { type: "target_result" }>;
      expect(result.output).toBe("Open a return request.");
      expect(result.duration).toBe(1200);
      expect(result.error).toBeUndefined();
    });

    /** @scenario "The agent's own spans join the cell's trace" */
    it("carries the cell's trace context", async () => {
      const dispatch = vi.fn<ConnectedDispatch>(async () => answered("ok"));

      const events = await run({
        cell: makeCell({ traceId: "a".repeat(32) }),
        dispatch,
      });

      const call = dispatch.mock.calls[0]![0];
      expect(call.call.traceparent).toMatch(/^00-a{32}-[0-9a-f]{16}-01$/);
      const result = events[1] as Extract<EvaluationV3Event, { type: "target_result" }>;
      expect(result.traceId).toBe("a".repeat(32));
    });

    /** @scenario "Every row is a separate conversation" */
    it("gives every row its own conversation and no session", async () => {
      const dispatch = vi.fn<ConnectedDispatch>(async () => answered("ok"));

      await run({ cell: makeCell({ rowIndex: 0 }), dispatch });
      await run({ cell: makeCell({ rowIndex: 1 }), dispatch });

      const threads = dispatch.mock.calls.map((call) => call[0].call.threadId);
      expect(threads[0]).not.toBe(threads[1]);
      for (const call of dispatch.mock.calls) {
        expect(call[0].call.session).toBeUndefined();
      }
    });
  });

  describe("when the column carries an evaluator", () => {
    /** @scenario "The evaluators grade the agent's answer" */
    it("grades the answer the agent gave", async () => {
      scripted.component = [
        {
          type: "component_state_change",
          payload: {
            component_id: "connected-target.eval-grading",
            execution_state: {
              status: "success",
              outputs: { score: 1, passed: true },
            },
          },
        },
      ] as unknown as StudioServerEvent[];

      const events = await run({
        cell: makeCell({ evaluatorConfigs: [gradingEvaluator] }),
        dispatch: vi.fn<ConnectedDispatch>(async () => answered("Open a return request.")),
      });

      const evaluatorInputs = scripted.dispatched[0]?.payload?.inputs as
        | Record<string, unknown>
        | undefined;
      expect(evaluatorInputs?.output).toBe("Open a return request.");

      const evaluatorResult = events.find((event) => event.type === "evaluator_result") as
        | Extract<EvaluationV3Event, { type: "evaluator_result" }>
        | undefined;
      expect(evaluatorResult?.result).toMatchObject({
        status: "processed",
        score: 1,
        passed: true,
      });
    });

    it("does not grade a row the agent never answered", async () => {
      const events = await run({
        cell: makeCell({ evaluatorConfigs: [gradingEvaluator] }),
        dispatch: vi.fn<ConnectedDispatch>(async () => {
          throw new AgentOfflineError({
            agentName: "Support agent",
            environment: "production",
          });
        }),
      });

      expect(events.some((event) => event.type === "evaluator_result")).toBe(false);
      expect(scripted.dispatched).toHaveLength(0);
    });
  });

  describe("when no process of the agent is connected", () => {
    /** @scenario "An offline agent names itself in the failure" */
    it("fails the cell with the offline code, not an unknown error", async () => {
      const events = await run({
        cell: makeCell(),
        dispatch: vi.fn<ConnectedDispatch>(async () => {
          throw new AgentOfflineError({
            agentName: "Support agent",
            environment: "production",
          });
        }),
      });

      const result = events[1] as Extract<EvaluationV3Event, { type: "target_result" }>;
      expect(result.error).toBe("agent_offline");
      expect(result.domainError?.code).toBe("agent_offline");
    });
  });

  describe("when every instance is busy", () => {
    /** @scenario "A busy agent is retried before the row fails" */
    it("tries again inside the budget", async () => {
      let attempts = 0;
      const dispatch = vi.fn<ConnectedDispatch>(async () => {
        attempts += 1;
        if (attempts < 3) throw new AgentBusyError({ retryAfterMs: 10 });
        return answered("Open a return request.");
      });

      const events = await run({ cell: makeCell(), dispatch });

      expect(attempts).toBe(3);
      const result = events[1] as Extract<EvaluationV3Event, { type: "target_result" }>;
      expect(result.output).toBe("Open a return request.");
    });

    /** @scenario "A busy agent is retried before the row fails" */
    it("fails the row with the busy code once the budget ends", async () => {
      const events: EvaluationV3Event[] = [];
      let clock = 0;
      for await (const event of executeConnectedCell({
        cell: makeCell(),
        projectId: "p1",
        agent,
        dispatch: async () => {
          throw new AgentBusyError({ retryAfterMs: 10 });
        },
        sleep: async () => undefined,
        ports,
        workflows,
        // Every read of the clock is a minute later, so the budget is spent
        // on the first retry rather than in real time.
        now: () => (clock += 60_000),
      })) {
        events.push(event);
      }

      const result = events[1] as Extract<EvaluationV3Event, { type: "target_result" }>;
      expect(result.error).toBe("agent_busy");
      expect(result.domainError?.code).toBe("agent_busy");
    });
  });
});

describe("given two columns of the same agent", () => {
  describe("when each column sets its own parameter value", () => {
    /** @scenario "Two parameter values compare side by side" */
    it("sends each column's own value", async () => {
      const dispatch = vi.fn<ConnectedDispatch>(async () => answered("ok"));

      const columnWith = (model: string): ExecutionCell => {
        const cell = makeCell();
        return {
          ...cell,
          targetId: `connected-${model}`,
          targetConfig: {
            ...cell.targetConfig,
            id: `connected-${model}`,
            mappings: {
              "dataset-1": {
                input: {
                  type: "source",
                  source: "dataset",
                  sourceId: "dataset-1",
                  sourceField: "question",
                },
                model: { type: "value", value: model },
              },
            },
          },
        };
      };

      await run({ cell: columnWith("gpt-5-mini"), dispatch });
      await run({ cell: columnWith("gpt-5"), dispatch });

      const models = dispatch.mock.calls.map((call) => call[0].call.params.model);
      expect(models).toEqual(["gpt-5-mini", "gpt-5"]);
    });
  });
});

describe("given a personal development agent of another person", () => {
  const personalAgent = {
    ...agent,
    environment: "development",
    ownerUserId: "user_someone_else",
  } as unknown as typeof agent;

  const stateWithConnectedTarget = (): EvaluationsV3State => ({
    name: "Evaluation",
    datasets: [{ id: "dataset-1", name: "Dataset" } as EvaluationsV3State["datasets"][0]],
    activeDatasetId: "dataset-1",
    targets: [makeCell().targetConfig as TargetConfig],
    evaluators: [],
    results: createInitialResults(),
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  });

  const inputFor = (actor: OrchestratorInput["actor"]): OrchestratorInput => ({
    projectId: "p1",
    scope: { type: "full" },
    state: stateWithConnectedTarget(),
    datasetRows: [{ question: "How do I return a broken item?" }],
    datasetColumns: [{ id: "col_1", name: "question", type: "string" }],
    loadedPrompts: new Map(),
    loadedAgents: new Map([["agent_1", personalAgent]]),
    ports,
    workflows,
    defaultConcurrency: 1,
    ...(actor ? { actor } : {}),
  });

  describe("when someone else starts the run", () => {
    /** @scenario "Another person's development agent is refused" */
    it("refuses the run with the owner-only code", async () => {
      const events: EvaluationV3Event[] = [];
      await expect(async () => {
        for await (const event of runOrchestrator(inputFor({ id: "user_me", label: "user" }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({ code: "agent_owner_only" });

      expect(events).toEqual([]);
    });
  });

  describe("when the run names no person at all", () => {
    /** @scenario "Another person's development agent is refused" */
    it("refuses it too", async () => {
      await expect(async () => {
        for await (const event of runOrchestrator(inputFor(undefined))) {
          void event;
        }
      }).rejects.toMatchObject({ code: "agent_owner_only" });
    });
  });
});
