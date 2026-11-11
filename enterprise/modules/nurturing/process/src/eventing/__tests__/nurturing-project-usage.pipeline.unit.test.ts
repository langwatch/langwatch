// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  EVALUATOR_CREATED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
} from "@langwatch/evaluator-contract";
import { createTenantId, type Event } from "@langwatch/eventing";
import {
  PROMPT_CREATED_EVENT_TYPE,
  PROMPT_DELETED_EVENT_TYPE,
  PROMPT_VERSION_SAVED_EVENT_TYPE,
} from "@langwatch/prompt-contract";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_SET_CREATED_EVENT_TYPE,
} from "@langwatch/scenario-contract";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import type { NurturingProjectUsageOwner } from "../../repositories/nurturing-project-usage.repository.ts";
import {
  evaluationDayKeyOf,
  type NurturingProjectUsagePeerEvent,
  nurturingProjectUsagePeerFold,
  nurturingTraceDaySubscriber,
  projectIdOf,
  projectUsageFactOf,
  traceSyncKeyOf,
} from "../nurturing-project-usage.pipeline.ts";

const OCCURRED_AT = 1_000;

/** The envelope every owner event carries, on tenant `project-1`. */
function envelope(type: string) {
  return {
    id: `${type}-event`,
    aggregateId: "aggregate-1",
    aggregateType: "owner",
    tenantId: createTenantId("project-1"),
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    version: "2026-11-09",
  };
}

const promptCreatedData = {
  promptId: "p1",
  projectId: "project-1",
  userId: "user-1",
  orgPromptCount: 1,
  occurredAt: OCCURRED_AT,
};
const promptCreated: NurturingProjectUsagePeerEvent = {
  ...envelope(PROMPT_CREATED_EVENT_TYPE),
  type: PROMPT_CREATED_EVENT_TYPE,
  data: promptCreatedData,
};
const promptVersionSaved: NurturingProjectUsagePeerEvent = {
  ...envelope(PROMPT_VERSION_SAVED_EVENT_TYPE),
  type: PROMPT_VERSION_SAVED_EVENT_TYPE,
  data: { promptId: "p1", projectId: "project-1", versionId: "v2", occurredAt: OCCURRED_AT },
};
const promptDeleted: NurturingProjectUsagePeerEvent = {
  ...envelope(PROMPT_DELETED_EVENT_TYPE),
  type: PROMPT_DELETED_EVENT_TYPE,
  data: { promptId: "p1", projectId: "project-1", occurredAt: OCCURRED_AT },
};
const evaluatorIds = {
  tenantId: "project-1",
  projectId: "project-1",
  evaluatorId: "e1",
  occurredAt: OCCURRED_AT,
};
const evaluatorCreated: NurturingProjectUsagePeerEvent = {
  ...envelope(EVALUATOR_CREATED_EVENT_TYPE),
  type: EVALUATOR_CREATED_EVENT_TYPE,
  data: evaluatorIds,
};
const evaluatorDeleted: NurturingProjectUsagePeerEvent = {
  ...envelope(EVALUATOR_DELETED_EVENT_TYPE),
  type: EVALUATOR_DELETED_EVENT_TYPE,
  data: evaluatorIds,
};
const scenarioCreated: NurturingProjectUsagePeerEvent = {
  ...envelope(SCENARIO_CREATED_EVENT_TYPE),
  type: SCENARIO_CREATED_EVENT_TYPE,
  data: {
    scenarioId: "s1",
    projectId: "project-1",
    userId: "user-1",
    scenarioCount: 3,
    occurredAt: OCCURRED_AT,
  },
};
const simulationSetCreated: NurturingProjectUsagePeerEvent = {
  ...envelope(SIMULATION_SET_CREATED_EVENT_TYPE),
  type: SIMULATION_SET_CREATED_EVENT_TYPE,
  data: { scenarioSetId: "set-1", projectId: "project-1", occurredAt: OCCURRED_AT },
};
const simulationFinished: NurturingProjectUsagePeerEvent = {
  ...envelope(SIMULATION_RUN_EVENT_TYPES.FINISHED),
  type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
  data: { scenarioRunId: "run-1" },
};

describe("projectUsageFactOf()", () => {
  /** @scenario "Every owner event becomes the fact its fold counts" */
  it.each<[NurturingProjectUsagePeerEvent, object]>([
    [promptCreated, { kind: "prompt_created", promptId: "p1" }],
    [promptVersionSaved, { kind: "prompt_version_saved" }],
    [promptDeleted, { kind: "prompt_deleted", promptId: "p1" }],
    [evaluatorCreated, { kind: "evaluator_created", evaluatorId: "e1" }],
    [evaluatorDeleted, { kind: "evaluator_deleted", evaluatorId: "e1" }],
    [scenarioCreated, { kind: "scenario_created", scenarioCount: 3 }],
    [simulationSetCreated, { kind: "simulation_set_created", scenarioSetId: "set-1" }],
    [simulationFinished, { kind: "scenario_run" }],
  ])("maps %# to its fact at the event's time", (event, fact) => {
    expect(projectUsageFactOf(event)).toEqual({ ...fact, occurredAt: OCCURRED_AT });
  });
});

describe("projectIdOf()", () => {
  /** @scenario "A fact without a project id is counted on its tenant" */
  it("takes the data's project id, else the event's tenant", () => {
    const elsewhere: NurturingProjectUsagePeerEvent = {
      ...envelope(PROMPT_CREATED_EVENT_TYPE),
      type: PROMPT_CREATED_EVENT_TYPE,
      data: { ...promptCreatedData, projectId: "project-2" },
    };

    expect(projectIdOf(elsewhere)).toBe("project-2");
    expect(projectIdOf(simulationFinished)).toBe("project-1");
  });
});

/** A peer fact as a subscriber's dedup reads it. */
const peerFact = (data: Record<string, unknown>, occurredAt = OCCURRED_AT): Event => ({
  ...envelope("peer"),
  type: "peer",
  data,
  occurredAt,
});

describe("traceSyncKeyOf()", () => {
  /** @scenario "Traces sync an organization at most once per 15 minutes" */
  it("keys a trace fact on its organization, so its projects share one window", () => {
    const first = peerFact({ projectId: "project-1", organizationId: "org-1" });
    const second = peerFact({ projectId: "project-2", organizationId: "org-1" });

    expect(traceSyncKeyOf(first)).toBe("subscriber:traceUsageSync:organization:org-1");
    expect(traceSyncKeyOf(second)).toBe(traceSyncKeyOf(first));
  });

  it("keys an older fact with no organization on its project", () => {
    expect(traceSyncKeyOf(peerFact({ projectId: "project-1" }))).toBe(
      "subscriber:traceUsageSync:project:project-1",
    );
  });
});

describe("evaluationDayKeyOf()", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOON = Date.UTC(2026, 10, 20, 12);

  /** @scenario "Evaluations mark a project's day once" */
  it("keys an evaluation on its project's UTC day", () => {
    const morning = peerFact({ projectId: "project-1" }, NOON - 6 * 60 * 60 * 1000);
    const evening = peerFact({ projectId: "project-1" }, NOON + 6 * 60 * 60 * 1000);
    const nextDay = peerFact({ projectId: "project-1" }, NOON + DAY_MS);

    expect(evaluationDayKeyOf(morning)).toBe("subscriber:evaluationActiveDay:project-1:2026-11-20");
    expect(evaluationDayKeyOf(evening)).toBe(evaluationDayKeyOf(morning));
    expect(evaluationDayKeyOf(nextDay)).not.toBe(evaluationDayKeyOf(morning));
  });
});

describe("the evaluation day row", () => {
  const NOON = Date.UTC(2026, 10, 20, 12);

  /** @scenario "Evaluations mark a project's day once" */
  it("adds the evaluation's day to the project's rows, once", async () => {
    const store = MemoryNurturingProjectUsageRepository.create();

    await store.recordEvaluationDay({ projectId: "project-1", occurredAt: NOON });
    await store.recordEvaluationDay({ projectId: "project-1", occurredAt: NOON + 1000 });

    const rows = await store.findForProjects({ projectIds: ["project-1"] });
    expect(rows.map((row) => row.activeDays)).toEqual([["2026-11-20"]]);
  });
});

describe("each owner's peer fold", () => {
  const cases: [NurturingProjectUsageOwner, NurturingProjectUsagePeerEvent, object][] = [
    ["prompt", promptCreated, { promptIds: ["p1"] }],
    ["evaluator", evaluatorCreated, { evaluatorIds: ["e1"] }],
    ["prompt", promptVersionSaved, { activeDays: ["1970-01-01"] }],
    ["scenario", scenarioCreated, { scenarioCount: 3 }],
    ["scenario", simulationSetCreated, { simulationSetIds: ["set-1"] }],
    ["simulation", simulationFinished, { hasScenarioRun: true }],
  ];

  /** @scenario "Each owner's fold turns its event into the project's row" */
  it.each(cases)("folds a %s event into the project's row", (owner, event, counted) => {
    const { fold } = nurturingProjectUsagePeerFold({
      owner,
      store: MemoryNurturingProjectUsageRepository.create(),
    });

    const state = fold.apply(fold.init(), event as never);

    expect(fold.key?.(event as never)).toBe("project-1");
    expect(state).toMatchObject({
      projectId: "project-1",
      LastEventOccurredAt: OCCURRED_AT,
      ...counted,
    });
  });

  /** @scenario "Each owner's fold turns its event into the project's row" */
  it("takes a prompt back out when it is deleted", () => {
    const { fold } = nurturingProjectUsagePeerFold({
      owner: "prompt",
      store: MemoryNurturingProjectUsageRepository.create(),
    });

    const state = [promptCreated, promptDeleted].reduce(
      (folded, event) => fold.apply(folded, event as never),
      fold.init(),
    );

    expect(state.promptIds).toEqual([]);
  });

  /** @scenario "Folds keyed across aggregates never re-fold from one aggregate's log" */
  it("folds an older event on as it comes, never re-folding the row from one prompt's log", () => {
    const { fold } = nurturingProjectUsagePeerFold({
      owner: "prompt",
      store: MemoryNurturingProjectUsageRepository.create(),
    });

    expect(fold.options).toMatchObject({ refoldOnOutOfOrder: false });
  });
});

describe("the trace-day count", () => {
  const NOON = Date.UTC(2026, 10, 20, 12);
  const OK = 1;
  const ERROR = 2;

  /** trace's span fact as the subscriber gets it: only the root marker and the status. */
  const spanData = (parentSpanId: string | null, code: typeof OK | typeof ERROR) => ({
    span: { parentSpanId, status: { message: null, code } },
  });

  /** One delivery: the span's project (tenant), its trace (aggregate) and append time. */
  const itemOf = (code: typeof OK | typeof ERROR, traceId: string, createdAt = NOON) => ({
    data: spanData(null, code),
    context: {
      tenantId: createTenantId("project-1"),
      aggregateId: traceId,
      createdAt,
      occurredAt: createdAt,
      eventId: `${traceId}-${createdAt}`,
    },
  });

  function harness() {
    const traceDays = MemoryNurturingTraceDayRepository.create();
    const subscriber = nurturingTraceDaySubscriber(traceDays);
    const days = () => traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    return { subscriber, days };
  }

  /** @scenario "A trace is its root span, counted on its project's day" */
  it("counts a root span on its project and the UTC day it was appended", async () => {
    const { subscriber, days } = harness();

    await subscriber.handleBatch([itemOf(OK, "trace-1", NOON + 11 * 3_600_000)]);
    await subscriber.handleBatch([itemOf(OK, "trace-2", NOON + 12 * 3_600_000)]);

    expect((await days()).map((day) => [day.day, day.traceCount]).toSorted()).toEqual([
      ["2026-11-20", 1],
      ["2026-11-21", 1],
    ]);
  });

  /** @scenario "Root spans of one project and day are written as one increment" */
  it("queues a project's day as one group and adds a batch's traces together", async () => {
    const { subscriber, days } = harness();
    const group = subscriber.options?.groupKeyFn;
    const event = (createdAt: number) => ({
      ...envelope(SPAN_RECEIVED_EVENT_TYPE),
      createdAt,
    });

    expect(group?.(event(NOON) as Event)).toBe(group?.(event(NOON + 1000) as Event));
    expect(group?.(event(NOON) as Event)).not.toBe(group?.(event(NOON + 86_400_000) as Event));
    expect(subscriber.options?.coalesceMaxBatch).toBeGreaterThan(1);

    await subscriber.handleBatch([itemOf(OK, "trace-1"), itemOf(ERROR, "trace-2")]);

    expect(await days()).toEqual([
      expect.objectContaining({ traceCount: 2, errorCount: 1, lastFailedTraceAt: NOON }),
    ]);
  });

  /** @scenario "Only a root span mints a trace-day job" */
  it("admits root spans to its queue and declines child spans", () => {
    const filter = harness().subscriber.options?.enqueue?.filter;

    expect(filter?.(spanData(null, OK))).toBe(true);
    expect(filter?.(spanData("", ERROR))).toBe(true);
    expect(filter?.(spanData("root-span", OK))).toBe(false);
  });

  /** @scenario "A redelivered batch may count its traces twice" */
  it("counts a redelivered root span again: the increment is not idempotent", async () => {
    const { subscriber, days } = harness();

    await subscriber.handleBatch([itemOf(OK, "trace-1")]);
    await subscriber.handleBatch([itemOf(OK, "trace-1")]);

    expect((await days())[0]?.traceCount).toBe(2);
  });

  /** @scenario "Traces arriving out of order count the same" */
  it("counts an older trace that arrives after a newer one", async () => {
    const { subscriber, days } = harness();

    await subscriber.handleBatch([itemOf(OK, "trace-2", NOON + 1000)]);
    await subscriber.handleBatch([itemOf(OK, "trace-1", NOON)]);

    expect(await days()).toEqual([
      expect.objectContaining({ traceCount: 2, lastTraceAt: NOON + 1000 }),
    ]);
  });
});
