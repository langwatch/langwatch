/**
 * @vitest-environment node
 * An experiment run executed on its pipeline, end to end: the api starts it, the worker runs
 * its cells, and polls and the stream read what the run's folds hold.
 * @see modules/experiment/specs/experiment-run-loop.feature
 */
import { randomUUID } from "node:crypto";

import { type AgentApi, type AgentOverview, AgentOwnerOnlyError } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  COMPARISON_EVALUATOR_TYPE,
  type EvaluationV3Event,
  type EvaluatorConfig,
  ExperimentRunLoopUnavailableError,
  ExperimentRunNotFoundError,
  type PersistedEvaluationsV3State,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ModelCost, ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { SuiteApi } from "@langwatch/suite-contract";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import {
  parseStudioWorkflow,
  type StudioServerEvent,
  type WorkflowVersionHistoryEntry,
  WorkflowVersionRequiredError,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { WorkbenchExecutionRequest } from "../../services/experiment-workbench-run.service.ts";
import {
  bootRunPair,
  connectTestDatabase,
  type EngineDispatch,
  fails,
  jobOf,
  pause,
  type RunPair,
  type RunPairOptions,
  succeeds,
} from "./experiment-run-installation.fixture.ts";

const connection: PrismaConnection | undefined = connectTestDatabase();
const namespace = `experiment-run-installation-${randomUUID()}`;
const ids = { organization: "", team: "", project: "", otherProject: "" };
const person = { id: "user_1" };
const CELL_FINISHED = "lw.experiment_run.cell_finished";

function database(): PrismaConnection {
  if (!connection) throw new Error("the installation suite needs LANGWATCH_TEST_DATABASE_URL");
  return connection;
}

const promptTarget = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    dataset_1: {
      input: { type: "source", source: "dataset", sourceId: "dataset_1", sourceField: "question" },
    },
  },
  localPromptConfig: {
    llm: { model: "openai/gpt-5-mini", temperature: 0 },
    messages: [{ role: "user", content: "{{input}}" }],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
});

const judge = (variants: string[]): EvaluatorConfig => ({
  id: "judge",
  evaluatorType: COMPARISON_EVALUATOR_TYPE,
  inputs: [],
  mappings: {},
  comparison: {
    variants,
    hasGoldenAnswer: false,
    goldenField: "",
    includeMetrics: [],
    randomizeOrder: false,
  },
});

const columns = [{ id: "question", name: "question", type: "string" }];

/** A browser's run over inline rows, one question per row. */
function execution({
  questions,
  targets = [promptTarget("target_a")],
  evaluators = [],
  concurrency,
}: {
  questions: string[];
  targets?: TargetConfig[];
  evaluators?: EvaluatorConfig[];
  concurrency?: number;
}): WorkbenchExecutionRequest {
  return {
    projectId: ids.project,
    name: "Installation run",
    dataset: {
      id: "dataset_1",
      name: "Inline",
      type: "inline",
      columns,
      inline: { columns, records: { question: questions } },
    },
    targets,
    evaluators,
    scope: { type: "full" },
    ...(concurrency === undefined ? {} : { concurrency }),
  };
}

/** A streamed run's frames as they arrive, and all of them once it ends. */
function collect(events: AsyncIterable<EvaluationV3Event>) {
  const frames: EvaluationV3Event[] = [];
  const ended = (async () => {
    for await (const frame of events) frames.push(frame);
    return frames;
  })();
  return { frames, ended };
}

/** The run id a stream announced in its first frame. */
async function runIdOf(frames: EvaluationV3Event[]): Promise<string> {
  return vi.waitFor(() => {
    const started = frames.find((frame) => frame.type === "execution_started");
    if (started?.type !== "execution_started") throw new Error("the run has not started yet");
    return started.runId;
  });
}

/** A latch a dispatch waits on until the test opens it. */
function latch() {
  let open = (): void => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
}

/** Whichever row a dispatch carries, read from its inputs. */
const asks = (dispatch: EngineDispatch, text: string): boolean =>
  JSON.stringify(dispatch.inputs).includes(text);

const answersEveryNode = async ({ nodeId }: EngineDispatch): Promise<StudioServerEvent[]> =>
  succeeds(nodeId, { output: `answer from ${nodeId}` });

const codeOf = async (operation: Promise<unknown>): Promise<string> => {
  try {
    await operation;
    return "no_error";
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "not_handled";
  }
};

async function withPair(
  options: Omit<RunPairOptions, "database">,
  test: (pair: RunPair) => Promise<void>,
): Promise<void> {
  const pair = await bootRunPair({ database: database(), ...options });
  try {
    await test(pair);
  } finally {
    await pair.stop();
  }
}

/** A polled run's status, once the poller reads it no longer running. */
async function settledStatus(pair: RunPair, runId: string) {
  return vi.waitFor(
    async () => {
      const status = await pair.api.pollRun({ projectId: ids.project, runId });
      if (status.status === "running" || status.status === "pending") {
        throw new Error(`run ${runId} is still ${status.status}`);
      }
      return status;
    },
    { timeout: 20_000, interval: 50 },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** One organisation, one team and two projects, so a foreign-project abort has a home. */
async function seedProjects(): Promise<void> {
  const db = database().client;
  const organization = await db.organization.create({
    data: { name: namespace, slug: namespace },
  });
  ids.organization = organization.id;
  const team = await db.team.create({
    data: { name: namespace, slug: namespace, organizationId: organization.id },
  });
  ids.team = team.id;
  const projects = await Promise.all(
    ["main", "other"].map((suffix) =>
      db.project.create({
        data: {
          name: `${namespace}-${suffix}`,
          slug: `${namespace}-${suffix}`,
          apiKey: `${namespace}-${suffix}`,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
      }),
    ),
  );
  ids.project = projects[0]?.id ?? "";
  ids.otherProject = projects[1]?.id ?? "";
}

async function cleanup(): Promise<void> {
  try {
    if (ids.project) {
      const projectIds = [ids.project, ids.otherProject];
      await cleanupTestRows(database().client, [
        ["experimentVersion", { projectId: { in: projectIds } }],
        ["experiment", { projectId: { in: projectIds } }],
        ["project", { id: { in: projectIds } }],
        ["team", { id: ids.team }],
        ["organization", { id: ids.organization }],
      ]);
    }
  } finally {
    await connection?.closeOnce();
  }
}

beforeAll(async () => {
  if (connection) await seedProjects();
});

afterAll(async () => {
  if (connection) await cleanup();
});

describe.skipIf(!connection)("given a workbench posting one row against one prompt target", () => {
  /** @scenario "A streamed workbench run executes on the worker and ends with done" */
  it("streams the worker's cell frames in order and ends with done", async () => {
    await withPair(
      { answer: async ({ nodeId }) => succeeds(nodeId, { output: "4" }) },
      async ({ api, engine }) => {
        const answer = await api.executeWorkbenchRun(
          execution({ questions: ["What is 2 + 2?"] }),
          person,
        );
        const frames = await collect(answer.events).ended;

        expect(frames.map((frame) => frame.type)).toEqual([
          "execution_started",
          "cell_started",
          "target_result",
          "progress",
          "done",
        ]);
        expect(frames[2]).toMatchObject({ rowIndex: 0, targetId: "target_a", output: "4" });
        expect(frames.at(-1)).toMatchObject({
          type: "done",
          summary: { totalCells: 1, completedCells: 1, failedCells: 0 },
        });
        expect(engine.dispatched.map((dispatch) => dispatch.nodeId)).toEqual(["target_a"]);
      },
    );
  });
});

describe.skipIf(!connection)("given a saved workbench with one row and one prompt target", () => {
  const savedState: PersistedEvaluationsV3State = {
    name: "Saved installation run",
    datasets: [
      {
        id: "dataset_1",
        name: "Inline",
        type: "inline",
        columns,
        inline: { columns, records: { question: ["What is 2 + 2?"] } },
      },
    ],
    activeDatasetId: "dataset_1",
    targets: [promptTarget("target_a")],
    evaluators: [],
  };

  /** @scenario "A polled run answers at once and is read back completed from the fold" */
  it("answers the run at once, writes the board, then reads it completed", async () => {
    const boardHeldAtCompletion: boolean[] = [];
    await withPair(
      {
        answer: async ({ nodeId }) => succeeds(nodeId, { output: "4" }),
        // The completion is sent only after the board write: main's order (spec section 7).
        beforeSend: async (payload) => {
          if (jobOf(payload) !== "command:completeExperimentRun") return;
          const written = await database().client.experimentVersion.count({
            where: { projectId: ids.project, runId: String(payload.runId) },
          });
          boardHeldAtCompletion.push(written > 0);
        },
      },
      async (pair) => {
        const created = await pair.api.createEvaluationsV3(
          { projectId: ids.project, state: savedState },
          { kind: "user", id: person.id },
        );

        const answer = await pair.api.startSavedRun({
          projectId: ids.project,
          projectSlug: "installation",
          slug: created.slug,
          body: "",
          acceptsEvents: false,
          credential: { kind: "apiKey", userId: person.id },
        });
        if (answer.kind !== "started") throw new Error("the saved run did not answer started");

        expect(answer).toMatchObject({ status: "running", total: 1 });
        expect(answer.runUrl).toContain(answer.runId);
        const settled = await settledStatus(pair, answer.runId);
        expect(settled).toMatchObject({ status: "completed", progress: 1, total: 1 });
        expect(boardHeldAtCompletion).toEqual([true]);
        const board = await pair.api.getWorkbenchState({
          projectId: ids.project,
          id: created.experimentId,
        });
        expect(JSON.stringify(board.state?.results?.targetOutputs)).toContain("4");
      },
    );
  });
});

describe.skipIf(!connection)("given a committed workflow", () => {
  const dsl = parseStudioWorkflow({
    spec_version: "1.4",
    workflow_id: "workflow_1",
    name: "Evaluate me",
    icon: "x",
    description: "",
    version: "1.0",
    default_llm: { model: "openai/gpt-5-mini" },
    template_adapter: "default",
    enable_tracing: true,
    state: {},
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        data: {
          name: "Entry point",
          outputs: [{ identifier: "question", type: "str" }],
          entry_selection: "first",
          train_size: 0.8,
          test_size: 0.2,
          seed: 42,
          dataset: {
            name: "inline",
            inline: {
              records: { question: ["What is 2 + 2?"] },
              columnTypes: [{ name: "question", type: "string" }],
            },
          },
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 300, y: 0 },
        data: { name: "End", inputs: [{ identifier: "output", type: "str" }] },
      },
    ],
    edges: [],
  });
  const committed: WorkflowVersionHistoryEntry = {
    id: "version_1",
    version: "1",
    autoSaved: false,
    commitMessage: "First",
    updatedAt: new Date(0),
    dsl,
    author: null,
  };
  const workflowRow = (): WorkflowWithVersion => ({
    id: `workflow_${randomUUID()}`,
    projectId: ids.project,
    name: "Evaluate me",
    icon: "x",
    description: "",
    latestVersionId: committed.id,
    currentVersionId: committed.id,
    publishedId: null,
    publishedById: null,
    copiedFromWorkflowId: null,
    isEvaluator: false,
    isComponent: false,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    currentVersion: null,
  });
  const flowAnswers = async (): Promise<StudioServerEvent[]> => [
    {
      type: "execution_state_change",
      payload: { execution_state: { status: "success", result: { output: "4" } } },
    },
  ];

  /** @scenario "The worker runs a requested workflow evaluation to completion" */
  it("starts the requested run on the worker's pipeline and completes it for the poller", async () => {
    const workflow = workflowRow();
    await withPair(
      {
        answer: flowAnswers,
        workflow: {
          getById: async () => workflow,
          getVersionHistory: async () => [committed],
        },
      },
      async (pair) => {
        const started = await pair.api.triggerWorkflowEvaluation({
          projectId: ids.project,
          projectSlug: "installation",
          workflowId: workflow.id,
        });

        const settled = await settledStatus(pair, started.runId);
        expect(settled).toMatchObject({ status: "completed", progress: 1, total: 1 });
        expect(pair.engine.dispatched.map((dispatch) => dispatch.type)).toEqual(["execute_flow"]);
        expect(pair.sentJobs("command:startExperimentRun")).toHaveLength(1);
      },
    );
  });

  /** @scenario "A workflow evaluation the worker cannot prepare completes as failed with its code" */
  it("completes the run failed with the refusal's code and runs no cell", async () => {
    const workflow = workflowRow();
    await withPair(
      {
        answer: flowAnswers,
        workflow: {
          getById: async () => workflow,
          getVersionHistory: async () => [committed],
        },
        // The version is gone by the time the worker prepares the run.
        workerWorkflow: { getVersionHistory: async () => [] },
      },
      async (pair) => {
        const started = await pair.api.triggerWorkflowEvaluation({
          projectId: ids.project,
          projectSlug: "installation",
          workflowId: workflow.id,
        });

        const settled = await settledStatus(pair, started.runId);
        expect(settled).toMatchObject({
          status: "failed",
          error: new WorkflowVersionRequiredError().code,
          total: 1,
        });
        expect(pair.sentJobs("command:startExperimentRun")).toEqual([]);
        expect(pair.sentJobs("command:executeExperimentCell")).toEqual([]);
        expect(pair.engine.dispatched).toEqual([]);
      },
    );
  });
});

describe.skipIf(!connection)("given a run of six cells started with a concurrency of two", () => {
  /** @scenario "Cells of one run never exceed its concurrency" */
  it("never has more than two cells at the engine, and completes every cell", async () => {
    await withPair(
      {
        answer: async (dispatch) => {
          await pause(40);
          return answersEveryNode(dispatch);
        },
      },
      async ({ api, engine }) => {
        const answer = await api.executeWorkbenchRun(
          execution({
            questions: ["one", "two", "three"],
            targets: [promptTarget("target_a"), promptTarget("target_b")],
            concurrency: 2,
          }),
          person,
        );
        const frames = await collect(answer.events).ended;

        expect(engine.dispatched).toHaveLength(6);
        expect(engine.maxInFlight).toBe(2);
        expect(frames.at(-1)).toMatchObject({
          type: "done",
          summary: { totalCells: 6, completedCells: 6, failedCells: 0 },
        });
      },
    );
  });
});

describe.skipIf(!connection)("given a run with two targets and a pairwise comparison", () => {
  const comparedRun = (questions: string[]) =>
    execution({
      questions,
      targets: [promptTarget("target_a"), promptTarget("target_b")],
      evaluators: [judge(["target_a", "target_b"])],
    });

  /** @scenario "Comparison cells run only after every target cell has finished" */
  it("counts the comparisons from the start and judges each row after its targets", async () => {
    const log: string[] = [];
    await withPair(
      {
        answer: async (dispatch) => {
          log.push(`start ${dispatch.nodeId}`);
          await pause(20);
          log.push(`end ${dispatch.nodeId}`);
          if (dispatch.nodeId.endsWith(".judge")) {
            return succeeds(dispatch.nodeId, { label: "target_a" });
          }
          const row = asks(dispatch, "first") ? "first" : "second";
          return succeeds(dispatch.nodeId, { output: `${dispatch.nodeId} on ${row}` });
        },
      },
      async ({ api, engine }) => {
        const answer = await api.executeWorkbenchRun(comparedRun(["first", "second"]), person);
        const frames = await collect(answer.events).ended;

        expect(frames[0]).toMatchObject({ type: "execution_started", total: 6 });
        const firstJudge = log.findIndex((entry) => entry.startsWith("start target_a.judge"));
        const lastTargetEnd = log.findLastIndex(
          (entry) => entry.startsWith("end") && !entry.endsWith(".judge"),
        );
        expect(firstJudge).toBeGreaterThan(lastTargetEnd);
        const judged = engine.dispatched.filter((dispatch) => dispatch.nodeId.endsWith("judge"));
        expect(judged).toHaveLength(2);
        for (const dispatch of judged) {
          const row = asks(dispatch, "target_a on first") ? "first" : "second";
          expect(asks(dispatch, `target_a on ${row}`)).toBe(true);
          expect(asks(dispatch, `target_b on ${row}`)).toBe(true);
        }
        expect(frames.at(-1)).toMatchObject({
          type: "done",
          summary: { totalCells: 6, completedCells: 6 },
        });
      },
    );
  });

  /** @scenario "A comparison row whose variant produced no output finishes skipped" */
  it("records the skip as the comparison's error and completes the run", async () => {
    await withPair(
      {
        answer: async (dispatch) =>
          dispatch.nodeId === "target_b"
            ? fails("target_b", "the model refused")
            : answersEveryNode(dispatch),
      },
      async ({ api, engine }) => {
        const answer = await api.executeWorkbenchRun(comparedRun(["only"]), person);
        const frames = await collect(answer.events).ended;

        const verdicts = frames.filter(
          (frame) => frame.type === "evaluator_result" && frame.evaluatorId === "judge",
        );
        expect(verdicts).toHaveLength(1);
        expect(verdicts[0]).toMatchObject({
          result: { status: "error", error_type: "MissingVariantOutput" },
        });
        expect(engine.dispatched.some((dispatch) => dispatch.nodeId.endsWith("judge"))).toBe(false);
        expect(frames.at(-1)).toMatchObject({ type: "done", summary: { totalCells: 3 } });
      },
    );
  });
});

describe.skipIf(!connection)("given a run whose comparison names fewer than two variants", () => {
  /** @scenario "A comparison that cannot be built is skipped for every row" */
  it("finishes every row's comparison skipped with the setup error, reaching no evaluator", async () => {
    await withPair({ answer: answersEveryNode }, async ({ api, engine }) => {
      const answer = await api.executeWorkbenchRun(
        execution({
          questions: ["first", "second"],
          targets: [promptTarget("target_a"), promptTarget("target_b")],
          evaluators: [judge(["target_a"])],
        }),
        person,
      );
      const frames = await collect(answer.events).ended;

      const verdicts = frames.filter(
        (frame) => frame.type === "evaluator_result" && frame.evaluatorId === "judge",
      );
      expect(verdicts).toHaveLength(2);
      for (const verdict of verdicts) {
        expect(verdict).toMatchObject({
          result: { status: "error", error_type: "TooFewComparisonVariants" },
        });
      }
      expect(engine.dispatched.some((dispatch) => dispatch.nodeId.endsWith("judge"))).toBe(false);
      expect(frames.at(-1)).toMatchObject({ type: "done", summary: { totalCells: 6 } });
    });
  });
});

describe.skipIf(!connection)("given a run in flight with cells still to execute", () => {
  /** @scenario "Aborting a running run stops its remaining cells" */
  it("stops the rest without reaching a target or planning a comparison", async () => {
    const held = latch();
    await withPair(
      {
        answer: async (dispatch) => {
          await held.opened;
          return answersEveryNode(dispatch);
        },
      },
      async (pair) => {
        const answer = await pair.api.executeWorkbenchRun(
          execution({
            questions: ["first", "second", "third"],
            targets: [promptTarget("target_a"), promptTarget("target_b")],
            evaluators: [judge(["target_a", "target_b"])],
            concurrency: 2,
          }),
          person,
        );
        const stream = collect(answer.events);
        const runId = await runIdOf(stream.frames);
        await vi.waitFor(() => expect(pair.engine.dispatched).toHaveLength(2));

        await expect(
          pair.api.abortWorkbenchRun({ projectId: ids.project, runId }, person),
        ).resolves.toMatchObject({ success: true, runId });
        held.open();
        const frames = await stream.ended;

        expect(frames.at(-1)?.type).toBe("stopped");
        expect(pair.engine.dispatched).toHaveLength(2);
        expect(pair.engine.dispatched.some((dispatch) => dispatch.nodeId.endsWith("judge"))).toBe(
          false,
        );
        expect(await settledStatus(pair, runId)).toMatchObject({ status: "stopped" });
      },
    );
  });

  /** @scenario "Aborting a run of another project is refused as not found" */
  it("refuses another project's abort as run_not_found and lets the run finish", async () => {
    const held = latch();
    await withPair(
      {
        answer: async (dispatch) => {
          await held.opened;
          return answersEveryNode(dispatch);
        },
      },
      async (pair) => {
        const answer = await pair.api.executeWorkbenchRun(
          execution({ questions: ["first", "second"] }),
          person,
        );
        const stream = collect(answer.events);
        const runId = await runIdOf(stream.frames);

        expect(
          await codeOf(pair.api.abortWorkbenchRun({ projectId: ids.otherProject, runId }, person)),
        ).toBe(new ExperimentRunNotFoundError(runId).code);
        held.open();
        const frames = await stream.ended;

        expect(frames.at(-1)).toMatchObject({
          type: "done",
          summary: { totalCells: 2, completedCells: 2 },
        });
      },
    );
  });
});

describe.skipIf(!connection)(
  "given a workbench whose target is someone else's personal development agent",
  () => {
    /** @scenario "A run against someone else's personal agent is refused before any cell" */
    it("refuses the run as agent_owner_only without starting it", async () => {
      const refusal = new AgentOwnerOnlyError({
        agentId: "agent_1",
        agentName: "Someone's laptop",
        ownerUserId: "user_2",
        ownerName: "Someone",
      });
      await withPair(
        {
          answer: answersEveryNode,
          api: {
            suite: createApiFixture<SuiteApi>({
              assertConnectedAgentsRunnable: async () => {
                throw refusal;
              },
            }),
          },
        },
        async (pair) => {
          const answer = await pair.api.executeWorkbenchRun(
            execution({ questions: ["first"] }),
            person,
          );
          const frames = await collect(answer.events).ended;

          expect(frames).toEqual([
            expect.objectContaining({ type: "error", message: refusal.code }),
          ]);
          expect(pair.sentJobs("command:startExperimentRun")).toEqual([]);
          expect(pair.sentJobs("command:executeExperimentCell")).toEqual([]);
          expect(pair.engine.dispatched).toEqual([]);
        },
      );
    });
  },
);

describe.skipIf(!connection)(
  "given a run whose cell commands and cell finishes are each delivered twice",
  () => {
    /** @scenario "A redelivered cell counts once" */
    it("ends its progress at the total and records each result once", async () => {
      await withPair(
        {
          answer: answersEveryNode,
          redeliver: (payload) =>
            jobOf(payload) === "command:executeExperimentCell" || payload.type === CELL_FINISHED,
        },
        async (pair) => {
          const answer = await pair.api.executeWorkbenchRun(
            execution({ questions: ["first", "second"] }),
            person,
          );
          const frames = await collect(answer.events).ended;
          const runId = await runIdOf(frames);

          const progress = frames.filter((frame) => frame.type === "progress");
          expect(progress.every((frame) => frame.completed <= frame.total)).toBe(true);
          expect(frames.filter((frame) => frame.type === "target_result")).toHaveLength(2);
          expect(frames.at(-1)).toMatchObject({
            type: "done",
            summary: { totalCells: 2, completedCells: 2 },
          });
          expect(await settledStatus(pair, runId)).toMatchObject({ progress: 2, total: 2 });
        },
      );
    });
  },
);

describe.skipIf(!connection)("given a run with a cell whose command never finishes", () => {
  /** @scenario "A cell lost with its worker fails once the run stalls, and the run completes with errors" */
  it("fails the lost cell once the stall window passes and completes the run", async () => {
    const lost = latch();
    // Installed before boot, so the wake worker's clock is this one.
    const realNow = Date.now.bind(Date);
    let skipped = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skipped);
    await withPair(
      {
        answer: async (dispatch) => {
          if (asks(dispatch, "lost")) await lost.opened;
          return answersEveryNode(dispatch);
        },
      },
      async (pair) => {
        try {
          const answer = await pair.api.executeWorkbenchRun(
            execution({ questions: ["kept", "lost"] }),
            person,
          );
          const stream = collect(answer.events);
          await vi.waitFor(() =>
            expect(stream.frames.some((frame) => frame.type === "target_result")).toBe(true),
          );
          await vi.waitFor(() => expect(pair.engine.dispatched).toHaveLength(2));
          skipped = 16 * 60_000;

          const frames = await stream.ended;

          expect(frames.at(-1)).toMatchObject({
            type: "done",
            summary: { totalCells: 2, failedCells: 1 },
          });
        } finally {
          lost.open();
        }
      },
    );
  });
});

describe.skipIf(!connection)("given a run whose target answers an error for one row", () => {
  /** @scenario "A failing target is a failed cell, not a failed run" */
  it("fails that cell with the error on its result and completes the run", async () => {
    await withPair(
      {
        answer: async (dispatch) =>
          asks(dispatch, "broken")
            ? fails(dispatch.nodeId, "the model refused")
            : answersEveryNode(dispatch),
      },
      async ({ api }) => {
        const answer = await api.executeWorkbenchRun(
          execution({ questions: ["fine", "broken"] }),
          person,
        );
        const frames = await collect(answer.events).ended;

        const results = frames.filter((frame) => frame.type === "target_result");
        expect(results.find((frame) => frame.rowIndex === 1)).toMatchObject({
          error: expect.stringContaining("the model refused"),
        });
        expect(results.find((frame) => frame.rowIndex === 0)).not.toHaveProperty("error");
        expect(frames.at(-1)).toMatchObject({
          type: "done",
          summary: { totalCells: 2, failedCells: 1 },
        });
      },
    );
  });
});

describe.skipIf(!connection)("given a target on a model the engine reports without a price", () => {
  const projectRule: ModelCost = {
    id: "cost_1",
    organizationId: "organization_1",
    projectId: "project_1",
    scopeType: "PROJECT",
    scopeId: "project_1",
    model: "my-fine-tune",
    regex: "^my-fine-tune$",
    inputCostPerToken: 0.001,
    outputCostPerToken: 0.002,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  const codeAgent: AgentOverview = {
    id: "agent_code",
    name: "Uppercase",
    projectId: "project_1",
    type: "code",
    config: {
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      parameters: [{ identifier: "code", type: "code", value: "return input.upper()" }],
    },
    workflowId: null,
    copiedFromAgentId: null,
    environment: null,
    ownerUserId: null,
    hostLabel: null,
    identityKey: null,
    lastSeenAt: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    inputFields: [],
    outputFields: [],
    fieldsResolved: true,
    parameters: [],
    owner: null,
    status: "offline",
    instances: [],
    selectable: true,
    notSelectableReason: null,
  };
  const codeTarget: TargetConfig = {
    id: "target_code",
    type: "agent",
    dbAgentId: codeAgent.id,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    mappings: {
      dataset_1: {
        input: {
          type: "source",
          source: "dataset",
          sourceId: "dataset_1",
          sourceField: "question",
        },
      },
    },
  };
  const agents = () => createApiFixture<AgentApi>({ getById: async () => codeAgent });

  /** @scenario "A cell is priced and lent the project's sandbox key" */
  it("prices the cell at the project's rule and lends it the project's sandbox key", async () => {
    const minted: string[] = [];
    await withPair(
      {
        answer: async ({ nodeId }) =>
          succeeds(
            nodeId,
            { output: "4" },
            { model: "my-fine-tune", prompt_tokens: 10, completion_tokens: 5 },
          ),
        api: { agent: agents() },
        worker: {
          agent: agents(),
          "model-provider": createApiFixture<ModelProviderApi>({
            listCosts: async () => [projectRule],
            estimateCost: ({ attrs }) =>
              attrs["langwatch.model.inputCostPerToken"] === 0.001 ? 0.5 : 0,
          }),
          "api-key": createApiFixture<ApiKeyApi>({
            getOrMintAgentSandboxKey: async ({ projectId }) => {
              minted.push(projectId);
              return "project-sandbox-key";
            },
          }),
        },
      },
      async ({ api, engine }) => {
        const answer = await api.executeWorkbenchRun(
          execution({ questions: ["priced"], targets: [codeTarget] }),
          person,
        );
        const frames = await collect(answer.events).ended;

        expect(frames.find((frame) => frame.type === "target_result")).toMatchObject({
          cost: 0.5,
        });
        expect(engine.dispatched.map((dispatch) => dispatch.sandboxKey)).toEqual([
          "project-sandbox-key",
        ]);
        expect(minted).toEqual([ids.project]);
      },
    );
  });
});

describe.skipIf(!connection)(
  "given a dataset with more rows than the project's tier allows",
  () => {
    /** @scenario "A run past the row bound is refused before it starts" */
    it("refuses the run as experiment_evaluation_too_many_rows and starts nothing", async () => {
      await withPair(
        {
          answer: answersEveryNode,
          api: {
            entitlement: createApiFixture<EntitlementApi>({ requestBound: async () => 1 }),
          },
        },
        async (pair) => {
          expect(
            await codeOf(
              pair.api.executeWorkbenchRun(execution({ questions: ["one", "two"] }), person),
            ),
          ).toBe("experiment_evaluation_too_many_rows");
          expect(pair.sentJobs("command:startExperimentRun")).toEqual([]);
        },
      );
    });
  },
);

describe.skipIf(!connection)("given a deployment without a public address", () => {
  it("refuses a run by name before sending anything", async () => {
    await withPair({ answer: answersEveryNode, publicBaseUrl: undefined }, async (pair) => {
      expect(
        await codeOf(pair.api.executeWorkbenchRun(execution({ questions: ["one"] }), person)),
      ).toBe(new ExperimentRunLoopUnavailableError({ capability: "public address" }).code);
      expect(pair.sentJobs("command:startExperimentRun")).toEqual([]);
    });
  });
});
