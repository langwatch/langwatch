/**
 * The run surface: the gate first, then the plan's cap, then the budget, and
 * only then anything that reads on the caller's behalf.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { InstantEvalNotEnabledError } from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import type { InstantEvalRunRow } from "../../repositories/instant-eval-run.repository.ts";
import type { InstantEvalFreeBudgetStanding } from "../../rules/instant-eval-budget.rules.ts";
import type { InstantEvalEstimate } from "../instant-eval-estimate.service.ts";
import { InstantEvalRunService, type InstantEvalRunPeers } from "../instant-eval-run.service.ts";
import type { InstantEvalSample } from "../instant-eval-sample.service.ts";
import type { AcceptedInstantEvalStatement } from "../instant-eval-statement.service.ts";

const NOW = Temporal.Instant.from("2026-09-18T12:00:00Z");
const ACTOR = { kind: "member", userId: "user-1" } as const;

const ACCEPTED: AcceptedInstantEvalStatement = {
  sql: "SELECT TraceId FROM analytics.traces",
  parameters: {},
  questions: [],
  plan: [],
  keyColumns: [],
  columns: [{ name: "TraceId", type: "String" }],
};

const ESTIMATE: InstantEvalEstimate = {
  rows: 100,
  isRowsCapped: false,
  avgTokens: 40,
  totalTokens: 4_000,
  requests: 100,
  costUsd: 0.01,
  priceUsd: 0.04,
};

const FREE: InstantEvalFreeBudgetStanding = {
  isFree: true,
  spentUsd: 0.2,
  budgetUsd: 1,
  remainingUsd: 0.8,
};

const PAID: InstantEvalFreeBudgetStanding = {
  isFree: false,
  spentUsd: 0,
  budgetUsd: 1,
  remainingUsd: null,
};

/** The statement unit, recording every statement it was asked to accept. */
class RecordingStatements {
  readonly accepted: { sql: string; parameters?: Readonly<Record<string, unknown>> }[] = [];

  async accept(input: {
    readonly sql: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
  }): Promise<AcceptedInstantEvalStatement> {
    this.accepted.push({
      sql: input.sql,
      ...(input.parameters ? { parameters: input.parameters } : {}),
    });
    return ACCEPTED;
  }
}

/** The create unit, minting one fixed id and recording what it was told. */
class RecordingCreates {
  readonly created: { runId: string; rowLimit: number; name: string | null }[] = [];

  constructor(private readonly failure?: Error) {}

  nextRunId(): string {
    return "instanteval_new";
  }

  async createRun(input: {
    projectId: string;
    runId?: string;
    name: string | null;
    rowLimit: number;
  }): Promise<InstantEvalRunRow> {
    if (this.failure) throw this.failure;
    this.created.push({
      runId: input.runId ?? "",
      rowLimit: input.rowLimit,
      name: input.name,
    });
    return instantEvalRunRow({ id: input.runId ?? "", rowLimit: input.rowLimit });
  }
}

/** The budget unit, recording the holds taken and released against it. */
class RecordingBudget {
  readonly reserved: { reservationId: string; priceUsd: number }[] = [];
  readonly released: string[] = [];
  asserted = 0;

  constructor(
    private readonly current: InstantEvalFreeBudgetStanding,
    private readonly releaseFailure?: Error,
  ) {}

  async standing(): Promise<InstantEvalFreeBudgetStanding> {
    return this.current;
  }

  async assertWithinBudget(): Promise<void> {
    this.asserted += 1;
  }

  async reserve(input: { reservationId: string; priceUsd: number }): Promise<void> {
    this.reserved.push({ reservationId: input.reservationId, priceUsd: input.priceUsd });
  }

  async release(input: { reservationId: string }): Promise<void> {
    if (this.releaseFailure) throw this.releaseFailure;
    this.released.push(input.reservationId);
  }
}

/** The units a run's surface stands on, each answering one fixed thing. */
function harness(
  options: {
    standing?: InstantEvalFreeBudgetStanding;
    peers?: Partial<InstantEvalRunPeers>;
    createFailure?: Error;
    releaseFailure?: Error;
  } = {},
) {
  const statements = new RecordingStatements();
  const creates = new RecordingCreates(options.createFailure);
  const budget = new RecordingBudget(options.standing ?? PAID, options.releaseFailure);
  const cancelled: { runId: string; requestedByUserId?: string }[] = [];
  const sampled: { runId: string; rows: number; lwqlKey: string }[] = [];

  const peers: InstantEvalRunPeers = {
    isEnabled: async () => true,
    isQueryIdentityAvailable: () => true,
    resolveCaller: async ({ projectId }) => ({
      project: { id: projectId, lwqlKey: "key-1" },
      protections: { canSeeCosts: true },
    }),
    getPlan: async () => ({ name: "Launch", isFree: true }),
    database: () => "analytics",
    ...options.peers,
  };

  const service = InstantEvalRunService.create({
    units: {
      statements,
      creates,
      budget,
      estimates: { estimateRun: async () => ESTIMATE },
      cancellations: {
        cancelRun: async (input) => {
          cancelled.push(input);
          return instantEvalRunRow({ id: input.runId, status: "CANCELLED" });
        },
      },
      reads: { getRun: async ({ runId }) => instantEvalRunRow({ id: runId }) },
      samples: {
        getSample: async (input): Promise<InstantEvalSample> => {
          sampled.push({
            runId: input.runId,
            rows: input.rows,
            lwqlKey: input.caller.lwqlKey,
          });
          return { rows: [], judgments: [] };
        },
      },
    },
    peers,
    now: () => NOW,
  });

  return { service, statements, creates, budget, cancelled, sampled };
}

describe("creating a run", () => {
  it("refuses a project the feature is not enabled for, before anything reads", async () => {
    const { service, statements } = harness({ peers: { isEnabled: async () => false } });

    await expect(
      service.createRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } }),
    ).rejects.toMatchObject({ code: "instant_eval_not_enabled" });
    expect(statements.accepted).toEqual([]);
  });

  it("refuses a project with no query identity provisioned", async () => {
    const { service } = harness({
      peers: {
        resolveCaller: async ({ projectId }) => ({
          project: { id: projectId, lwqlKey: "" },
          protections: {},
        }),
      },
    });

    await expect(
      service.createRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } }),
    ).rejects.toBeInstanceOf(InstantEvalNotEnabledError);
  });

  it("refuses more rows than the plan allows", async () => {
    const { service, statements } = harness();

    await expect(
      service.createRun({
        projectId: "project-1",
        actor: ACTOR,
        input: { sql: "SELECT 1", limit: 50_000 },
      }),
    ).rejects.toMatchObject({ code: "instant_eval_row_cap_exceeded" });
    expect(statements.accepted).toEqual([]);
  });

  it("defaults the rows to the plan's own cap when the caller names none", async () => {
    const { service, creates } = harness();

    await service.createRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } });

    expect(creates.created).toEqual([{ runId: "instanteval_new", rowLimit: 10_000, name: null }]);
  });

  it("holds the estimated price under the run's own id for a free organization", async () => {
    const { service, budget } = harness({ standing: FREE });

    await service.createRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } });

    expect(budget.asserted).toBe(1);
    expect(budget.reserved).toEqual([{ reservationId: "instanteval_new", priceUsd: 0.04 }]);
  });

  it("holds nothing for an organization the budget does not bound", async () => {
    const { service, budget } = harness({ standing: PAID });

    await service.createRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } });

    expect(budget.reserved).toEqual([]);
  });

  it("releases the hold when the run is never queued", async () => {
    const { service, budget } = harness({
      standing: FREE,
      createFailure: new Error("the queue is down"),
    });

    await expect(
      service.createRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } }),
    ).rejects.toThrow("the queue is down");
    expect(budget.released).toEqual(["instanteval_new"]);
  });

  it("raises the reason the run was not queued even when the hold cannot be released", async () => {
    const { service } = harness({
      standing: FREE,
      createFailure: new Error("the queue is down"),
      releaseFailure: new Error("redis is down"),
    });

    await expect(
      service.createRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } }),
    ).rejects.toThrow("the queue is down");
  });
});

describe("a target rather than a statement", () => {
  const shorthand = {
    target: "traces",
    filter: "topics:billing",
    questions: [{ id: "annoyed", kind: "boolean", instructions: "Is the user annoyed?" }],
  } as const;

  it("binds the trace ids the filter selects, resolved once at the run's own cap", async () => {
    const asked: { filter: string; limit: number }[] = [];
    const { service, statements } = harness({
      peers: {
        selectTraceIds: async ({ filter, limit }) => {
          asked.push({ filter, limit });
          return ["trace-1", "trace-2"];
        },
      },
    });

    await service.createRun({
      projectId: "project-1",
      actor: ACTOR,
      input: { shorthand: { ...shorthand, questions: [...shorthand.questions] } },
    });

    expect(asked).toEqual([{ filter: "topics:billing", limit: 10_000 }]);
    expect(statements.accepted[0]?.parameters).toMatchObject({
      instant_eval_selection_ids: ["trace-1", "trace-2"],
    });
  });

  it("refuses a filter it cannot resolve rather than judging the whole window", async () => {
    const { service, statements } = harness();

    await expect(
      service.createRun({
        projectId: "project-1",
        actor: ACTOR,
        input: { shorthand: { ...shorthand, questions: [...shorthand.questions] } },
      }),
    ).rejects.toMatchObject({ code: "instant_eval_query_invalid" });
    expect(statements.accepted).toEqual([]);
  });

  it("resolves nothing for a target that carries no filter", async () => {
    const asked: string[] = [];
    const { service } = harness({
      peers: {
        selectTraceIds: async ({ filter }) => {
          asked.push(filter);
          return [];
        },
      },
    });

    await service.createRun({
      projectId: "project-1",
      actor: ACTOR,
      input: {
        shorthand: {
          target: "traces",
          questions: [...shorthand.questions],
        },
      },
    });

    expect(asked).toEqual([]);
  });
});

describe("estimating a run", () => {
  it("carries what the free budget has left beside the price", async () => {
    const { service } = harness({ standing: FREE });

    await expect(
      service.estimateRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } }),
    ).resolves.toMatchObject({ priceUsd: 0.04, freeBudgetRemainingUsd: 0.8 });
  });

  it("carries no remainder for an organization the budget does not bound", async () => {
    const { service } = harness({ standing: PAID });
    const estimate = await service.estimateRun({
      projectId: "project-1",
      actor: ACTOR,
      input: { sql: "SELECT 1" },
    });

    expect(estimate).toEqual(ESTIMATE);
  });

  it("is never refused by the budget, because it judges nothing", async () => {
    const { service, budget } = harness({ standing: FREE });

    await service.estimateRun({ projectId: "project-1", actor: ACTOR, input: { sql: "SELECT 1" } });

    expect(budget.asserted).toBe(0);
    expect(budget.reserved).toEqual([]);
  });
});

describe("cancelling and sampling", () => {
  it("passes the asker on to the cancellation, under the feature's own gate", async () => {
    const { service, cancelled } = harness();

    await service.cancelRun({
      projectId: "project-1",
      runId: "instanteval_1",
      requestedByUserId: "user-1",
    });

    expect(cancelled).toEqual([
      { projectId: "project-1", runId: "instanteval_1", requestedByUserId: "user-1" },
    ]);
  });

  it("refuses a cancellation on a project the feature is not enabled for", async () => {
    const { service, cancelled } = harness({ peers: { isEnabled: async () => false } });

    await expect(
      service.cancelRun({ projectId: "project-1", runId: "instanteval_1" }),
    ).rejects.toMatchObject({ code: "instant_eval_not_enabled" });
    expect(cancelled).toEqual([]);
  });

  it("samples as the project's own restricted identity", async () => {
    const { service, sampled } = harness();

    await service.getSample({
      projectId: "project-1",
      actor: ACTOR,
      runId: "instanteval_1",
      rows: 5,
    });

    expect(sampled).toEqual([{ runId: "instanteval_1", rows: 5, lwqlKey: "key-1" }]);
  });
});
