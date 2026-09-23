/**
 * The failure contract of a run's three steps: an attempt below the cap is
 * rethrown so the outbox retries it, the final attempt records the run as
 * failed and retires the message, and a lost outcome write never costs a page.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { IntentContext } from "@langwatch/eventing";
import { InstantEvalQueryInvalidError } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  createInstantEvalFinishHandler,
  createInstantEvalJudgePageHandler,
  createInstantEvalPlanHandler,
  type InstantEvalDispatchDeps,
  type InstantEvalOutcomeCommands,
  type InstantEvalPageOutcome,
  type InstantEvalPlan,
  type InstantEvalRunExecutor,
  type InstantEvalSpend,
} from "../instant-eval-processing.intent.ts";

const RUN_ID = "instanteval_1";
const PROJECT_ID = "project-1";
const NOW = 1_758_000_000_000;

/** The pipeline's write surface, recording every command it was sent. */
class RecordingCommands implements InstantEvalOutcomeCommands {
  readonly planned: Record<string, unknown>[] = [];
  readonly pages: Record<string, unknown>[] = [];
  readonly finishes: Record<string, unknown>[] = [];

  constructor(private readonly failsWith?: Error) {}

  async recordPlanned(args: Record<string, unknown>): Promise<unknown> {
    if (this.failsWith) throw this.failsWith;
    this.planned.push(args);

    return undefined;
  }

  async recordPageJudged(args: Record<string, unknown>): Promise<unknown> {
    if (this.failsWith) throw this.failsWith;
    this.pages.push(args);

    return undefined;
  }

  async recordFinished(args: Record<string, unknown>): Promise<unknown> {
    if (this.failsWith) throw this.failsWith;
    this.finishes.push(args);

    return undefined;
  }
}

/** The run's steps, each answering one fixed outcome or raising one error. */
class ScriptedExecutor implements InstantEvalRunExecutor {
  constructor(private readonly raises?: Error) {}

  async plan(): Promise<InstantEvalPlan> {
    if (this.raises) throw this.raises;

    return { total: 1_200, pageSize: 500, isCapped: false, keyColumns: ["ThreadId"] };
  }

  readonly deadlines: (number | null | undefined)[] = [];

  async judgePage(input: { deadlineAt?: number | null }): Promise<InstantEvalPageOutcome> {
    this.deadlines.push(input.deadlineAt);
    if (this.raises) throw this.raises;

    return {
      rows: 500,
      matched: 12,
      matchedByQuestion: { annoyed: 12 },
      failed: 1,
      skipped: 0,
      inputTokens: 900,
      requests: 500,
      cursor: "t1000",
      cursorSpanId: null,
      hasNextPage: true,
    };
  }

  async finish(): Promise<InstantEvalSpend> {
    if (this.raises) throw this.raises;

    return { costUsd: 0.000021, priceUsd: 0.0000273 };
  }
}

function deps({
  raises,
  commands = new RecordingCommands(),
}: {
  raises?: Error;
  commands?: RecordingCommands;
} = {}): { deps: InstantEvalDispatchDeps; commands: RecordingCommands } {
  return {
    deps: {
      executor: new ScriptedExecutor(raises),
      commands: () => commands,
      clock: () => NOW,
    },
    commands,
  };
}

function intentContext(attempt: number): IntentContext {
  return {
    processName: "instantEval",
    projectId: PROJECT_ID,
    processKey: RUN_ID,
    tenantId: PROJECT_ID,
    messageKey: `plan:${RUN_ID}`,
    attempt,
  };
}

const PLAN_PAYLOAD = { runId: RUN_ID, projectId: PROJECT_ID };
const PAGE_PAYLOAD = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  page: 2,
  afterTraceId: "t500",
  afterSpanId: null,
  pageSize: 500,
  remaining: 700,
  keyColumns: ["ThreadId"],
};
const FINISH_PAYLOAD = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  outcome: "finished" as const,
  errorCode: null,
  inputTokens: 2_000,
  requests: 1_000,
};

describe("given a step that succeeds", () => {
  describe("when the plan lands", () => {
    it("records what the key pass found", async () => {
      const { deps: dispatch, commands } = deps();

      await createInstantEvalPlanHandler(dispatch)(PLAN_PAYLOAD, intentContext(1));

      expect(commands.planned[0]).toMatchObject({
        tenantId: PROJECT_ID,
        runId: RUN_ID,
        total: 1_200,
        pageSize: 500,
        keyColumns: ["ThreadId"],
      });
    });
  });

  describe("when a page is judged", () => {
    it("records the counts and the cursor the page ended on", async () => {
      const { deps: dispatch, commands } = deps();

      await createInstantEvalJudgePageHandler(dispatch)(PAGE_PAYLOAD, intentContext(1));

      expect(commands.pages[0]).toMatchObject({
        page: 2,
        rows: 500,
        matched: 12,
        cursor: "t1000",
        hasNextPage: true,
      });
    });
  });

  describe("when the delivery carries its lease", () => {
    it("bounds the page by the instant the lease lapses", async () => {
      const executor = new ScriptedExecutor();
      const { deps: dispatch } = deps();

      await createInstantEvalJudgePageHandler({ ...dispatch, executor })(PAGE_PAYLOAD, {
        ...intentContext(1),
        leaseExpiresAt: NOW + 45_000,
      });

      expect(executor.deadlines).toEqual([NOW + 45_000]);
    });
  });

  describe("when the run finishes", () => {
    /** @scenario "A finished run reports its spend once" */
    it("records the outcome with what the run cost", async () => {
      const { deps: dispatch, commands } = deps();

      await createInstantEvalFinishHandler(dispatch)(FINISH_PAYLOAD, intentContext(1));

      expect(commands.finishes).toEqual([
        {
          tenantId: PROJECT_ID,
          occurredAt: NOW,
          runId: RUN_ID,
          outcome: "finished",
          errorCode: null,
          inputTokens: 2_000,
          requests: 1_000,
          costUsd: 0.000021,
          priceUsd: 0.0000273,
        },
      ]);
    });
  });
});

describe("given a step that fails", () => {
  describe("when attempts remain", () => {
    it("rethrows so the outbox delivers it again", async () => {
      const { deps: dispatch, commands } = deps({ raises: new Error("clickhouse is away") });

      await expect(
        createInstantEvalJudgePageHandler(dispatch)(PAGE_PAYLOAD, intentContext(1)),
      ).rejects.toThrow("clickhouse is away");
      expect(commands.finishes).toEqual([]);
    });
  });

  describe("when it was the final attempt", () => {
    it("fails the run rather than handing the message back", async () => {
      const { deps: dispatch, commands } = deps({ raises: new Error("clickhouse is away") });

      await createInstantEvalJudgePageHandler(dispatch)(PAGE_PAYLOAD, intentContext(3));

      expect(commands.finishes[0]).toMatchObject({
        outcome: "failed",
        errorCode: "internal_error",
      });
    });

    it("carries a handled refusal's own code onto the run", async () => {
      const { deps: dispatch, commands } = deps({
        raises: new InstantEvalQueryInvalidError({ reason: "the statement cannot be run" }),
      });

      await createInstantEvalPlanHandler(dispatch)(PLAN_PAYLOAD, intentContext(3));

      expect(commands.finishes[0]).toMatchObject({
        outcome: "failed",
        errorCode: "instant_eval_query_invalid",
      });
    });

    it("keeps the spend a failing finish already knew about", async () => {
      const { deps: dispatch, commands } = deps({ raises: new Error("the ledger is away") });

      await createInstantEvalFinishHandler(dispatch)(FINISH_PAYLOAD, intentContext(3));

      expect(commands.finishes[0]).toMatchObject({
        outcome: "failed",
        inputTokens: 2_000,
        requests: 1_000,
      });
    });
  });
});

describe("given a judged page whose record cannot be written", () => {
  describe("when the command fails", () => {
    /** @scenario "A redelivered page writes the same judgements rather than doubling them" */
    it("returns rather than throwing, because a retry would judge the page again", async () => {
      const { deps: dispatch } = deps({
        commands: new RecordingCommands(new Error("bus is away")),
      });

      await expect(
        createInstantEvalJudgePageHandler(dispatch)(PAGE_PAYLOAD, intentContext(1)),
      ).resolves.toBeUndefined();
    });
  });
});
