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
import { organizationSignedUpEventDataSchema } from "@langwatch/organization-contract";
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
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  TRACE_FAILED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import type { NurturingProjectUsageOwner } from "../../repositories/nurturing-project-usage.repository.ts";
import { TRACE_COUNTING_WINDOW_MS } from "../../rules/nurturing-project-usage.rules.ts";
import {
  evaluationDayKeyOf,
  nurturingMembershipSubscriber,
  UNCOPIED_TRACE_RETRY_MS,
  nurturingEvaluationDaySubscriber,
  nurturingFailedTraceDaySubscriber,
  type NurturingProjectUsagePeerEvent,
  nurturingProjectUsagePeerFold,
  nurturingTraceDaySubscriber,
  nurturingTraceUsageSyncSubscribers,
  organizationUsageSubscriber,
  projectIdOf,
  projectUsageFactOf,
  traceSyncKeyOf,
} from "../nurturing-project-usage.pipeline.ts";

const OCCURRED_AT = 1_000;

/** Long after every trace here, so a trace nurturing has no copies for is dropped. */
const LONG_AFTER = Date.UTC(2030, 0, 1);

/**
 * The trace counts' dependencies: project-1 in org-1, created `createdAt`, once `copied` in
 * nurturing's placement copy and, once `organizationCopied`, in its creation copy; any other
 * project is never placed. `now` is the handling time.
 */
function countingOver({
  createdAt,
  traceDays = MemoryNurturingTraceDayRepository.create(),
  copied = true,
  organizationCopied = copied,
  now = () => LONG_AFTER,
}: {
  createdAt: number;
  traceDays?: MemoryNurturingTraceDayRepository;
  copied?: boolean;
  organizationCopied?: boolean;
  now?: () => number;
}) {
  const placements = MemoryNurturingProjectPlacementRepository.create({
    placed: new Map(copied ? [["project-1", "org-1"]] : []),
  });
  const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create({
    createdAt: new Map(organizationCopied ? [["org-1", createdAt]] : []),
  });
  return {
    traceDays,
    placements,
    organizationsCreated,
    now,
    /** The copies' subscribers catch up. */
    landCopies: async () => {
      await placements.recordProject({ projectId: "project-1", organizationId: "org-1" });
      await organizationsCreated.recordOrganizationCreated({ organizationId: "org-1", createdAt });
    },
  };
}

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

describe("the evaluation day subscriber", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOON = Date.UTC(2026, 10, 20, 12);
  const evaluation = (projectId: string, occurredAt: number) => ({
    tenantId: projectId,
    projectId,
    evaluationId: `evaluation-${occurredAt}`,
    occurredAt,
  });
  const contextOf = (occurredAt: number) => ({
    tenantId: createTenantId("project-1"),
    aggregateId: `evaluation-${occurredAt}`,
    createdAt: occurredAt,
    occurredAt,
    eventId: `event-${occurredAt}`,
  });

  /** @scenario "A project's evaluation days are written one at a time" */
  it("queues a project's evaluations in one lane whatever their day, so both days are kept", async () => {
    const store = MemoryNurturingProjectUsageRepository.create();
    const subscriber = nurturingEvaluationDaySubscriber(store);
    const group = subscriber.options?.groupKeyFn;

    expect(group?.(peerFact(evaluation("project-1", NOON), NOON))).toBe(
      group?.(peerFact(evaluation("project-1", NOON + DAY_MS), NOON + DAY_MS)),
    );
    expect(group?.(peerFact(evaluation("project-2", NOON), NOON))).not.toBe(
      group?.(peerFact(evaluation("project-1", NOON), NOON)),
    );

    if (!subscriber.handle) throw new Error("the evaluation day handles one fact at a time");
    await subscriber.handle(evaluation("project-1", NOON), contextOf(NOON));
    await subscriber.handle(evaluation("project-1", NOON + DAY_MS), contextOf(NOON + DAY_MS));

    const rows = await store.findForProjects({ projectIds: ["project-1"] });
    expect(rows.map((row) => row.activeDays.toSorted())).toEqual([["2026-11-20", "2026-11-21"]]);
  });
});

describe("the fold's organization sync", () => {
  /** @scenario "A steady stream of a project's facts still syncs within a minute" */
  it("pins a project's sync to its first fact, so a steady stream cannot push it back", () => {
    const { delay, dedup } = organizationUsageSubscriber(() => Promise.resolve());

    expect(delay).toBe(60_000);
    expect(dedup).toMatchObject({ ttlMs: 60_000, extend: false, replace: true });
    if (typeof dedup !== "object") throw new Error("the sync dedups per project");
    expect(dedup.makeId(promptCreated)).toBe(dedup.makeId(promptVersionSaved));
    expect(dedup.makeId(promptCreated)).toBe("project:project-1");
  });
});

describe("the trace syncs", () => {
  const firstTraceData = {
    tenantId: "project-1",
    projectId: "project-1",
    userId: "user-1",
    sdkLanguage: "python",
    sdkFramework: "unknown",
    occurredAt: OCCURRED_AT,
  };
  const context = {
    tenantId: createTenantId("project-1"),
    aggregateId: "project-1",
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    eventId: "first-trace-event",
  };

  /** @scenario "A project's first trace syncs its organization too" */
  it("syncs on a project's first trace, throttled as a later trace's sync is", async () => {
    const synced: string[] = [];
    const { firstTrace, laterTrace } = nurturingTraceUsageSyncSubscribers(({ projectId }) => {
      synced.push(projectId);
      return Promise.resolve();
    });

    expect(firstTrace.eventType).toBe(FIRST_TRACE_RECORDED_EVENT_TYPE);
    expect(firstTrace.options).toEqual(laterTrace.options);
    if (!firstTrace.handle) throw new Error("the first-trace sync handles one fact at a time");
    await firstTrace.handle(firstTrace.data.parse(firstTraceData), context);

    expect(synced).toEqual(["project-1"]);
  });

  /** @scenario "A project's first trace syncs its organization too" */
  it("counts the first trace once, by its root span: the sync writes no count", async () => {
    const counting = countingOver({ createdAt: context.createdAt });
    const { traceDays } = counting;
    const { firstTrace } = nurturingTraceUsageSyncSubscribers(() => Promise.resolve());
    const rootSpan = { span: { traceId: "trace-1", parentSpanId: null } };

    await nurturingTraceDaySubscriber(counting).handleBatch([{ data: rootSpan, context }]);
    if (!firstTrace.handle) throw new Error("the first-trace sync handles one fact at a time");
    await firstTrace.handle(firstTrace.data.parse(firstTraceData), context);

    const days = await traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    expect(days.map((day) => day.traceCount)).toEqual([1]);
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

  /** trace's span fact as the subscriber gets it: trace, root marker, a status it ignores. */
  const spanData = (
    parentSpanId: string | null,
    code: typeof OK | typeof ERROR,
    traceId = "trace-1",
  ) => ({
    span: { traceId, parentSpanId, status: { message: null, code } },
  });

  /** One delivery: the span's project (tenant), its trace and append time. */
  const itemOf = (code: typeof OK | typeof ERROR, traceId: string, createdAt = NOON) => ({
    data: spanData(null, code, traceId),
    context: {
      tenantId: createTenantId("project-1"),
      aggregateId: traceId,
      createdAt,
      occurredAt: createdAt,
      eventId: `${traceId}-${createdAt}`,
    },
  });

  /** project-1's organization, created the day before NOON unless told otherwise. */
  function harness(createdAt = NOON - 86_400_000) {
    const counting = countingOver({ createdAt });
    const subscriber = nurturingTraceDaySubscriber(counting);
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    return { subscriber, days };
  }

  /** @scenario "A trace is its root span, counted on its project's day" */
  it("counts a root span on its project and the UTC day it was appended", async () => {
    const { subscriber, days } = harness();

    await subscriber.handleBatch([itemOf(OK, "trace-1", NOON + 11 * 3_600_000)]);
    await subscriber.handleBatch([itemOf(OK, "trace-2", NOON + 12 * 3_600_000)]);

    const counted = (await days())
      .map((day) => [day.day, day.traceCount] as const)
      .toSorted(([a], [b]) => a.localeCompare(b));
    expect(counted).toEqual([
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

    await subscriber.handleBatch([itemOf(OK, "trace-1"), itemOf(OK, "trace-2")]);

    expect(await days()).toEqual([expect.objectContaining({ traceCount: 2 })]);
  });

  /** @scenario "A failed trace is counted from trace's trace_failed fact" */
  it("counts no failed trace from a root span's error status alone", async () => {
    const { subscriber, days } = harness();

    await subscriber.handleBatch([itemOf(ERROR, "trace-1")]);

    expect(await days()).toEqual([
      expect.objectContaining({ traceCount: 1, errorCount: 0, lastFailedTraceAt: null }),
    ]);
  });

  /** @scenario "Only a root span mints a trace-day job" */
  it("admits root spans to its queue and declines child spans", () => {
    const filter = harness().subscriber.options?.enqueue?.filter;

    expect(filter?.(spanData(null, OK))).toBe(true);
    expect(filter?.(spanData("", ERROR))).toBe(true);
    expect(filter?.(spanData("root-span", OK))).toBe(false);
  });

  /** An OTLP `langwatch.origin` attribute, as trace's span fact carries it. */
  const originAttribute = (origin: string) => ({
    key: "langwatch.origin",
    value: { stringValue: origin },
  });

  /** A root span's raw fact: its origin on the span and on its resource, either absent. */
  const rawRoot = ({ span, resource }: { span?: string; resource?: string }) => ({
    span: {
      traceId: "trace-1",
      parentSpanId: null,
      status: { message: null, code: OK },
      attributes: span ? [originAttribute(span)] : [],
    },
    resource: { attributes: resource ? [originAttribute(resource)] : [] },
  });

  /** @scenario "Sample and Langy traces are not counted" */
  it.each([
    ["a sample span", rawRoot({ span: "sample" }), false],
    ["a Langy resource", rawRoot({ resource: "langy" }), false],
    ["a Langy span", rawRoot({ span: "langy" }), false],
    ["an application span", rawRoot({ span: "application" }), true],
    ["no origin", rawRoot({}), true],
    [
      "a span origin over its resource's",
      rawRoot({ span: "application", resource: "langy" }),
      true,
    ],
  ])("decides whether a root span of %s is queued", (_name, raw, queued) => {
    const { subscriber } = harness();

    expect(subscriber.options?.enqueue?.filter?.(subscriber.data.parse(raw))).toBe(queued);
  });

  /** @scenario "Sample and Langy traces are not counted" */
  it("counts no sample or Langy root span a queue already holds", async () => {
    const { subscriber, days } = harness();
    const parsed = (raw: ReturnType<typeof rawRoot>) => subscriber.data.parse(raw);

    await subscriber.handleBatch([
      { ...itemOf(OK, "trace-1"), data: parsed(rawRoot({ span: "sample" })) },
      { ...itemOf(OK, "trace-2"), data: parsed(rawRoot({ resource: "langy" })) },
      { ...itemOf(OK, "trace-3"), data: parsed(rawRoot({ span: "application" })) },
    ]);

    expect((await days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "A trace stored twice counts once" */
  it("counts a re-stored or redelivered root span once", async () => {
    const { subscriber, days } = harness();

    await subscriber.handleBatch([itemOf(OK, "trace-1"), itemOf(OK, "trace-1", NOON + 1000)]);
    await subscriber.handleBatch([itemOf(OK, "trace-1", NOON + 2000)]);

    expect(await days()).toEqual([expect.objectContaining({ traceCount: 1, lastTraceAt: NOON })]);
  });

  /** @scenario "An organization past its counting window writes no counts" */
  it("counts no trace of an organization past its window, nor of one never seen created", async () => {
    const past = harness(NOON - TRACE_COUNTING_WINDOW_MS);
    const inside = harness(NOON - TRACE_COUNTING_WINDOW_MS + 1);

    await past.subscriber.handleBatch([itemOf(OK, "trace-1")]);
    await inside.subscriber.handleBatch([itemOf(OK, "trace-1")]);
    await inside.subscriber.handleBatch([
      {
        ...itemOf(OK, "trace-2"),
        context: { ...itemOf(OK, "trace-2").context, tenantId: createTenantId("project-9") },
      },
    ]);

    expect(await past.days()).toEqual([]);
    expect((await inside.days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "A new project's first trace waits for nurturing's copies" */
  it("retries a young trace until its copies land late, then counts it once", async () => {
    let now = NOON + 1000;
    const counting = countingOver({
      createdAt: NOON - 86_400_000,
      copied: false,
      now: () => now,
    });
    const subscriber = nurturingTraceDaySubscriber(counting);
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });

    await expect(subscriber.handleBatch([itemOf(OK, "trace-1")])).rejects.toThrow(
      "has not landed yet",
    );
    expect(await days()).toEqual([]);

    now = NOON + UNCOPIED_TRACE_RETRY_MS - 1;
    await counting.landCopies();
    await subscriber.handleBatch([itemOf(OK, "trace-1")]);
    await subscriber.handleBatch([itemOf(OK, "trace-1")]);
    expect((await days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "A new project's first trace waits for nurturing's copies" */
  it("drops without failing a trace whose copies never land, once it is past the retry span", async () => {
    let now = NOON + UNCOPIED_TRACE_RETRY_MS - 1;
    const counting = countingOver({ createdAt: NOON - 86_400_000, copied: false, now: () => now });
    const subscriber = nurturingTraceDaySubscriber(counting);

    await expect(subscriber.handleBatch([itemOf(OK, "trace-1")])).rejects.toThrow(
      "has not landed yet",
    );
    now = NOON + UNCOPIED_TRACE_RETRY_MS;
    await subscriber.handleBatch([itemOf(OK, "trace-1")]);

    await expect(
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" }),
    ).resolves.toEqual([]);
    expect(UNCOPIED_TRACE_RETRY_MS).toBe(2 * 60 * 60_000);
  });

  /** @scenario "A trace of an organization older than nurturing's creation copy is dropped" */
  it("drops without a retry a young trace of a placed project whose organization has no creation copy", async () => {
    const counting = countingOver({
      createdAt: NOON - 86_400_000,
      organizationCopied: false,
      now: () => NOON + 1000,
    });

    await nurturingTraceDaySubscriber(counting).handleBatch([itemOf(OK, "trace-1")]);

    await expect(
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" }),
    ).resolves.toEqual([]);
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

describe("the failed-trace count", () => {
  const NOON = Date.UTC(2026, 10, 20, 12);

  /** trace's trace_failed fact as trace records it. */
  const failedData = (traceId: string, origin?: string) => ({
    tenantId: "project-1",
    projectId: "project-1",
    traceId,
    occurredAt: NOON,
    ...(origin ? { origin } : {}),
  });

  function harness(createdAt = NOON - 86_400_000) {
    const counting = countingOver({ createdAt });
    const subscriber = nurturingFailedTraceDaySubscriber(counting);
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    /** One delivery; a redelivery carries a new event id but trace's idempotency key. */
    const itemOf = (traceId: string, origin?: string, createdAt = NOON, delivery = 1) => ({
      data: subscriber.data.parse(failedData(traceId, origin)),
      context: {
        tenantId: createTenantId("project-1"),
        aggregateId: `project-1:${traceId}`,
        createdAt,
        occurredAt: createdAt,
        eventId: `${traceId}-failed-${delivery}`,
        idempotencyKey: `project-1:trace_failed:${traceId}`,
      },
    });
    return { subscriber, days, itemOf };
  }

  /** @scenario "A redelivered trace_failed counts its failure once" */
  it("counts a trace's failure once however often its fact is delivered", async () => {
    const { subscriber, days, itemOf } = harness();

    await subscriber.handleBatch([itemOf("trace-1"), itemOf("trace-1", undefined, NOON, 2)]);
    await subscriber.handleBatch([itemOf("trace-1", undefined, NOON + 1000, 3)]);

    expect(await days()).toEqual([
      expect.objectContaining({ errorCount: 1, lastFailedTraceAt: NOON }),
    ]);
  });

  /** @scenario "An organization past its counting window writes no counts" */
  it("counts no failure of an organization past its window", async () => {
    const { subscriber, days, itemOf } = harness(NOON - TRACE_COUNTING_WINDOW_MS);

    await subscriber.handleBatch([itemOf("trace-1")]);

    expect(await days()).toEqual([]);
  });

  /** @scenario "A failed trace is counted from trace's trace_failed fact" */
  it("counts each trace_failed on its project's day of append, with the newest time", async () => {
    const { subscriber, days, itemOf } = harness();

    expect(subscriber.eventType).toBe(TRACE_FAILED_EVENT_TYPE);
    await subscriber.handleBatch([
      itemOf("trace-1"),
      itemOf("trace-2", "application", NOON + 1000),
    ]);

    expect(await days()).toEqual([
      {
        projectId: "project-1",
        day: "2026-11-20",
        traceCount: 0,
        errorCount: 2,
        lastTraceAt: null,
        lastFailedTraceAt: NOON + 1000,
      },
    ]);
  });

  /** @scenario "Root spans of one project and day are written as one increment" */
  it("queues failures on the same project and day group as the trace count", () => {
    const { subscriber } = harness();
    const traceGroup = nurturingTraceDaySubscriber(countingOver({ createdAt: NOON })).options
      ?.groupKeyFn;
    const event = { ...envelope(TRACE_FAILED_EVENT_TYPE), createdAt: NOON } as Event;

    expect(subscriber.options?.groupKeyFn?.(event)).toBe(traceGroup?.(event));
    expect(subscriber.options?.coalesceMaxBatch).toBeGreaterThan(1);
  });

  /** @scenario "Sample and Langy traces are not counted" */
  it("queues and counts no failure of a sample or Langy trace", async () => {
    const { subscriber, days, itemOf } = harness();
    const filter = subscriber.options?.enqueue?.filter;

    expect(filter?.(itemOf("trace-1", "sample").data)).toBe(false);
    expect(filter?.(itemOf("trace-1", "langy").data)).toBe(false);
    expect(filter?.(itemOf("trace-1").data)).toBe(true);

    await subscriber.handleBatch([
      itemOf("trace-1", "sample"),
      itemOf("trace-2", "langy"),
      itemOf("trace-3"),
    ]);
    expect((await days()).map((day) => day.errorCount)).toEqual([1]);
  });
});

describe("nurturing's member copy", () => {
  const ORGANIZATION_SIGNED_UP = "lw.organization.signed_up";
  const factAt = (organizationId: string, occurredAt: number) => ({
    tenantId: organizationId,
    organizationId,
    userId: "user-1",
    occurredAt,
    organizationName: "Acme",
  });
  const context = {
    tenantId: createTenantId("org-1"),
    aggregateId: "org-1",
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    eventId: "member-event",
  };
  const subscriberOf = (
    members: MemoryNurturingOrganizationMemberRepository,
    change: "joined" | "left" | "returned",
  ) =>
    nurturingMembershipSubscriber({
      eventType: ORGANIZATION_SIGNED_UP,
      data: organizationSignedUpEventDataSchema,
      change,
      members,
    });
  const handle = async (
    subscriber: ReturnType<typeof subscriberOf>,
    organizationId: string,
    at: number,
  ) => {
    if (!subscriber.handle) throw new Error("a member fact is handled one at a time");
    await subscriber.handle(subscriber.data.parse(factAt(organizationId, at)), context);
  };

  /** @scenario "Nurturing keeps its own copy of an organization's members" */
  it("keeps each change's latest time, whatever the order or how often it is delivered", async () => {
    const members = MemoryNurturingOrganizationMemberRepository.create();
    const joined = subscriberOf(members, "joined");
    const left = subscriberOf(members, "left");

    await handle(left, "org-1", 3_000);
    await handle(joined, "org-1", 1_000);
    await handle(joined, "org-1", 1_000);
    await handle(joined, "org-2", 2_000);

    expect(
      (await members.findMembershipsOfMembers({ organizationId: "org-1" })).toSorted((a, b) =>
        a.organizationId.localeCompare(b.organizationId),
      ),
    ).toEqual([
      {
        organizationId: "org-1",
        userId: "user-1",
        joinedAt: 1_000,
        leftAt: 3_000,
        returnedAt: null,
      },
      {
        organizationId: "org-2",
        userId: "user-1",
        joinedAt: 2_000,
        leftAt: null,
        returnedAt: null,
      },
    ]);
  });
});
