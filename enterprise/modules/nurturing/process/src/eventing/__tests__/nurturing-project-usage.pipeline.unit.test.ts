// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE } from "@langwatch/evaluation-contract";
import {
  EVALUATOR_CREATED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
} from "@langwatch/evaluator-contract";
import { createTenantId, type Event } from "@langwatch/eventing";
import {
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
} from "@langwatch/organization-contract";
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
import { createTestLogger } from "@langwatch/test-harness";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  TRACE_FAILED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingErasedUserRepository } from "../../repositories/memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingEvaluationDayRepository } from "../../repositories/memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import {
  MemoryNurturingClaimRepository,
  MemoryNurturingRepositories,
} from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingProjectUsageOwner } from "../../repositories/nurturing-project-usage.repository.ts";
import type { NurturingMembership } from "../../rules/nurturing-organization-member.rules.ts";
import { NurturingCopiedProjectsService } from "../../services/nurturing-copied-projects.service.ts";
import { NurturingOrganizationUsageService } from "../../services/nurturing-organization-usage.service.ts";
import {
  evaluationDayGroupOf,
  nurturingEvaluationDaysMap,
  type NurturingProjectUsagePeerEvent,
  nurturingProjectUsagePeerFold,
  nurturingTraceDayFailuresFold,
  nurturingTraceDaySpansFold,
  nurturingTraceUsageSyncSubscribers,
  organizationUsageSubscriber,
  projectIdOf,
  projectUsageFactOf,
  traceSyncKeyOf,
} from "../nurturing-project-usage.pipeline.ts";
import {
  copiesOver,
  liveMapsOver,
  ownerFact,
} from "./nurturing-organization-copies.test-helpers.ts";
import { foldLive, spanReceived, traceFailed } from "./nurturing-trace-days.test-helpers.ts";

const OCCURRED_AT = 1_000;

/** A store that keeps nothing, for a fold whose declaration alone a test reads. */
const KEEP_NOTHING = MemoryNurturingTraceDayRepository.create().forSource("spans");

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

describe("the evaluation-day map", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOON = Date.UTC(2026, 10, 20, 12);
  const evaluated = (projectId: string, occurredAt: number) =>
    ({
      ...envelope(EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE),
      id: `evaluation-${projectId}-${occurredAt}`,
      type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
      occurredAt,
      data: {
        tenantId: projectId,
        projectId,
        evaluationId: `evaluation-${occurredAt}`,
        occurredAt,
      },
    }) as const;
  /** Each fact through the map's mapping and store, one write a fact, as the live lane runs it. */
  const deliverEach = async (
    events: readonly ReturnType<typeof evaluated>[],
    evaluationDays = MemoryNurturingEvaluationDayRepository.create(),
  ) => {
    const { map } = nurturingEvaluationDaysMap(evaluationDays);
    for (const event of events) {
      const record = map.map(event);
      if (!record) continue;
      await map.store.append(record, { aggregateId: event.id, tenantId: event.tenantId });
    }
    return evaluationDays;
  };

  /** @scenario "Evaluations mark a project's day once" */
  it("keeps one row for many evaluations of a project on one UTC day, a redelivery included", async () => {
    const morning = evaluated("project-1", NOON - 6 * 60 * 60 * 1000);
    const evening = evaluated("project-1", NOON + 6 * 60 * 60 * 1000);

    const days = await deliverEach([morning, evening, morning]);

    await expect(
      days.findForProjects({ projectIds: ["project-1"], afterDay: "2026-01-01" }),
    ).resolves.toEqual([{ projectId: "project-1", day: "2026-11-20" }]);
  });

  /** @scenario "A project's evaluation days are kept once each, whatever order and however often they land" */
  it("holds the same days whatever order the evaluations land in", async () => {
    const facts = [0, 1, 2].map((n) => evaluated("project-1", NOON + n * DAY_MS));

    const forward = await deliverEach(facts);
    const reverse = await deliverEach(facts.toReversed());

    const read = { projectIds: ["project-1"], afterDay: "2026-01-01" };
    const sorted = async (days: MemoryNurturingEvaluationDayRepository) =>
      (await days.findForProjects(read)).map(({ day }) => day).toSorted();
    expect(await sorted(forward)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(await sorted(reverse)).toEqual(await sorted(forward));
  });

  /** @scenario "Evaluations mark a project's day once" */
  it("queues a project's evaluations of one UTC day in one group, so a burst is one write", () => {
    const { map } = nurturingEvaluationDaysMap(MemoryNurturingEvaluationDayRepository.create());

    expect(map.options?.coalesceMaxBatch).toBeGreaterThan(1);
    expect(map.store.bulkAppend).toBeDefined();
    expect(map.options?.groupKeyFn).toBe(evaluationDayGroupOf);
    expect(evaluationDayGroupOf(evaluated("project-1", NOON))).toBe(
      evaluationDayGroupOf(evaluated("project-1", NOON + 1000)),
    );
    expect(evaluationDayGroupOf(evaluated("project-1", NOON + DAY_MS))).not.toBe(
      evaluationDayGroupOf(evaluated("project-1", NOON)),
    );
    expect(evaluationDayGroupOf(evaluated("project-2", NOON))).not.toBe(
      evaluationDayGroupOf(evaluated("project-1", NOON)),
    );
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

  /** @scenario "Traces sync an organization at most once per 15 minutes" */
  it("syncs an organization once for three projects' first traces inside one window", async () => {
    const projectIds = ["project-1", "project-2", "project-3"];
    const members = MemoryNurturingOrganizationMemberRepository.create();
    await members.recordMembershipChange({
      organizationId: "org-1",
      userId: "member-1",
      change: "joined",
      at: OCCURRED_AT,
    });
    const milestones = MemoryNurturingMilestonesRepository.create();
    await milestones.recordOrganization({
      organizationId: "org-1",
      adminUserId: "admin-1",
      seeded: false,
    });
    const sent: CioBatchCall[] = [];
    const placements = MemoryNurturingProjectPlacementRepository.create({
      placed: new Map(projectIds.map((projectId) => [projectId, "org-1"])),
    });
    const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create({
      createdAt: new Map([["org-1", OCCURRED_AT]]),
    });
    const usage = NurturingOrganizationUsageService.create({
      projectUsage: MemoryNurturingProjectUsageRepository.create(),
      traceDays: MemoryNurturingTraceDayRepository.create(),
      evaluationDays: MemoryNurturingEvaluationDayRepository.create(),
      copiedProjects: NurturingCopiedProjectsService.create({ placements, organizationsCreated }),
      placements,
      organizationsCreated,
      milestones,
      members,
      erasedUsers: MemoryNurturingErasedUserRepository.create(),
      claims: MemoryNurturingClaimRepository.create(),
      sendBatch: async (calls) => {
        sent.push(...calls);
      },
      clock: { nowMs: () => OCCURRED_AT + 60_000 },
      logger: createTestLogger().logger,
      syncs: { inc: () => {} },
    });
    const { firstTrace } = nurturingTraceUsageSyncSubscribers((input) =>
      usage.tracesChanged(input),
    );
    const dedup = firstTrace.options?.deduplication;
    if (!dedup || dedup === "aggregate") throw new Error("the first-trace sync throttles on a key");
    if (!firstTrace.handle) throw new Error("the first-trace sync handles one fact at a time");
    const firstTraces: Event[] = projectIds.map((projectId) => ({
      ...envelope(FIRST_TRACE_RECORDED_EVENT_TYPE),
      id: `first-trace-${projectId}`,
      aggregateId: projectId,
      tenantId: createTenantId(projectId),
      type: FIRST_TRACE_RECORDED_EVENT_TYPE,
      data: { ...firstTraceData, tenantId: projectId, projectId, organizationId: "org-1" },
    }));

    // The queue keeps one job per dedup id inside the window, its latest send.
    const jobs = new Map(firstTraces.map((event) => [dedup.makeId(event), event]));
    for (const job of jobs.values()) {
      await firstTrace.handle(firstTrace.data.parse(job.data), context);
    }

    expect(jobs.size).toBe(1);
    expect(sent.map(({ type, userId }) => [type, userId])).toEqual([
      ["group", "admin-1"],
      ["identify", "member-1"],
    ]);
  });

  /** @scenario "Traces sync an organization at most once per 15 minutes" */
  it("queues two traces of one organization inside the window as one job", () => {
    const { firstTrace, laterTrace } = nurturingTraceUsageSyncSubscribers(() => Promise.resolve());
    const traceOf = (traceId: string): Event => ({
      ...envelope(TRACE_RECEIVED_EVENT_TYPE),
      id: `received-${traceId}`,
      aggregateId: traceId,
      tenantId: createTenantId("project-1"),
      type: TRACE_RECEIVED_EVENT_TYPE,
      data: { projectId: "project-1", organizationId: "org-1" },
    });

    for (const sync of [firstTrace, laterTrace]) {
      const group = sync.options?.groupKeyFn;
      const dedup = sync.options?.deduplication;
      if (!group || !dedup || dedup === "aggregate") throw new Error("the sync throttles on a key");
      // The queue squashes a staged job only under the same dedup id in the same group.
      const jobs = new Set(
        [traceOf("trace-1"), traceOf("trace-2")].map((event) =>
          JSON.stringify([group(event), dedup.makeId(event)]),
        ),
      );

      expect(jobs.size).toBe(1);
      expect(group(traceOf("trace-1"))).toBe("subscriber:traceUsageSync:organization:org-1");
    }
  });

  /** @scenario "A project's first trace syncs its organization too" */
  it("counts the first trace once, by its root span: the sync writes no count", async () => {
    const traceDays = MemoryNurturingTraceDayRepository.create();
    const { firstTrace } = nurturingTraceUsageSyncSubscribers(() => Promise.resolve());

    await foldLive({
      spans: traceDays.forSource("spans"),
      failures: traceDays.forSource("failures"),
      facts: [spanReceived({ id: "trace-1", createdAt: context.createdAt })],
    });
    if (!firstTrace.handle) throw new Error("the first-trace sync handles one fact at a time");
    await firstTrace.handle(firstTrace.data.parse(firstTraceData), context);

    const days = await traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    expect(days.map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "trace_active_day is never sent twice for a member and day" */
  it("tracks trace_active_day once on the member for the counted day, however often the sync job runs", async () => {
    const traceDays = MemoryNurturingTraceDayRepository.create();
    const placements = MemoryNurturingProjectPlacementRepository.create({
      placed: new Map([["project-1", "org-1"]]),
    });
    const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create({
      createdAt: new Map([["org-1", OCCURRED_AT]]),
    });
    const members = MemoryNurturingOrganizationMemberRepository.create();
    await members.recordMembershipChange({
      organizationId: "org-1",
      userId: "member-1",
      change: "joined",
      at: OCCURRED_AT,
    });
    const milestones = MemoryNurturingMilestonesRepository.create();
    await milestones.recordOrganization({
      organizationId: "org-1",
      adminUserId: "admin-1",
      seeded: false,
    });
    const sent: CioBatchCall[] = [];
    const usage = NurturingOrganizationUsageService.create({
      projectUsage: MemoryNurturingProjectUsageRepository.create(),
      traceDays,
      evaluationDays: MemoryNurturingEvaluationDayRepository.create(),
      copiedProjects: NurturingCopiedProjectsService.create({ placements, organizationsCreated }),
      placements,
      organizationsCreated,
      milestones,
      members,
      erasedUsers: MemoryNurturingErasedUserRepository.create(),
      claims: MemoryNurturingClaimRepository.create(),
      sendBatch: async (calls) => {
        sent.push(...calls);
      },
      clock: { nowMs: () => OCCURRED_AT + 60_000 },
      logger: createTestLogger().logger,
      syncs: { inc: () => {} },
    });
    const { firstTrace } = nurturingTraceUsageSyncSubscribers((input) =>
      usage.tracesChanged(input),
    );

    await foldLive({
      spans: traceDays.forSource("spans"),
      failures: traceDays.forSource("failures"),
      facts: [spanReceived({ id: "trace-1", createdAt: context.createdAt })],
    });
    if (!firstTrace.handle) throw new Error("the first-trace sync handles one fact at a time");
    // A redelivered sync job runs the same handler again.
    await firstTrace.handle(firstTrace.data.parse(firstTraceData), context);
    await firstTrace.handle(firstTrace.data.parse(firstTraceData), context);

    expect(sent.filter((call) => call.type === "track")).toEqual([
      {
        type: "track",
        userId: "member-1",
        event: "trace_active_day",
        messageId: "trace_active_day:member-1:1970-01-01",
        properties: { date: "1970-01-01", days_since_signup: 0 },
      },
    ]);
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

describe("the trace-day spans fold", () => {
  const NOON = Date.UTC(2026, 10, 20, 12);
  const { events, fold } = nurturingTraceDaySpansFold(
    MemoryNurturingTraceDayRepository.create().forSource("spans"),
  );
  const [{ data: spanSchema }] = events;

  /** trace's span fact as the fold gets it: parsed by the fold's own contract schema. */
  const spanOf = (raw: ReturnType<typeof spanReceived>) => ({
    ...raw,
    tenantId: createTenantId(raw.tenantId),
    type: SPAN_RECEIVED_EVENT_TYPE,
    data: spanSchema.parse(raw.data),
  });
  const root = (id: string, createdAt = NOON) => spanOf(spanReceived({ id, createdAt }));
  const foldAll = (spans: readonly ReturnType<typeof spanOf>[]) =>
    spans.reduce((state, span) => fold.apply(state, span), fold.init());

  /** @scenario "A trace is its root span, counted on its project's day" */
  it("counts a root span on its project and the UTC day it was appended", () => {
    const late = root("trace-1", NOON + 11 * 3_600_000);
    const nextDay = root("trace-2", NOON + 12 * 3_600_000);

    expect(fold.key?.(late)).toBe(JSON.stringify(["project-1", "2026-11-20"]));
    expect(fold.key?.(nextDay)).toBe(JSON.stringify(["project-1", "2026-11-21"]));
    expect(foldAll([late])).toEqual({
      projectId: "project-1",
      day: "2026-11-20",
      traceCount: 1,
      errorCount: 0,
      lastTraceAt: NOON + 11 * 3_600_000,
      lastFailedTraceAt: null,
    });
  });

  /** @scenario "A failed trace is counted from trace's trace_failed fact" */
  it("counts no failed trace from a root span, whatever its status", () => {
    expect(foldAll([root("trace-1")])).toMatchObject({ errorCount: 0, lastFailedTraceAt: null });
  });

  /** @scenario "Only a root span mints a trace-day fold job" */
  it("stages root spans and declines child spans, and counts no child span a replay hands it", () => {
    const filter = fold.options?.enqueue?.filter;
    const child = spanOf(spanReceived({ id: "child", createdAt: NOON, parentSpanId: "root" }));

    expect(filter?.(root("trace-1"))).toBe(true);
    expect(filter?.(spanOf(spanReceived({ id: "empty", createdAt: NOON, parentSpanId: "" })))).toBe(
      true,
    );
    expect(filter?.(child)).toBe(false);
    expect(foldAll([child])).toEqual(fold.init());
  });

  /** @scenario "Sample and Langy traces are not counted" */
  it.each([
    ["a sample span", "sample", false],
    ["a Langy span", "langy", false],
    ["an application span", "application", true],
    ["no origin", undefined, true],
  ])("decides whether a root span of %s is staged and counted", (_name, origin, counted) => {
    const span = spanOf(spanReceived({ id: "trace-1", createdAt: NOON, origin }));

    expect(fold.options?.enqueue?.filter?.(span)).toBe(counted);
    expect(foldAll([span]).traceCount).toBe(counted ? 1 : 0);
  });

  /** @scenario "Sample and Langy traces are not counted" */
  it("reads a Langy origin on the span's resource, and the span's own over it", () => {
    const withResource = (resource: string, spanOrigin?: string) => {
      const raw = spanReceived({ id: "trace-1", createdAt: NOON, origin: spanOrigin });
      return spanOf({
        ...raw,
        data: {
          ...(raw.data as object),
          resource: { attributes: [{ key: "langwatch.origin", value: { stringValue: resource } }] },
        },
      });
    };

    expect(fold.options?.enqueue?.filter?.(withResource("langy"))).toBe(false);
    expect(fold.options?.enqueue?.filter?.(withResource("langy", "application"))).toBe(true);
  });

  /** @scenario "Governance-ingested traces are not counted" */
  it.each([
    ["governance ingest", "ingestion_source", false],
    ["another origin kind", "something_else", true],
  ])("decides whether a root span of %s is staged and counted", (_name, kind, counted) => {
    const raw = spanReceived({ id: "trace-1", createdAt: NOON });
    const data = raw.data as { span: object };
    const span = spanOf({
      ...raw,
      data: {
        ...data,
        span: {
          ...data.span,
          attributes: [{ key: "langwatch.origin.kind", value: { stringValue: kind } }],
        },
      },
    });

    expect(fold.options?.enqueue?.filter?.(span)).toBe(counted);
    expect(foldAll([span]).traceCount).toBe(counted ? 1 : 0);
  });

  /** @scenario "Traces arriving out of order count the same" */
  it("counts an older trace that arrives after a newer one, keeping the newer time", () => {
    expect(foldAll([root("trace-2", NOON + 1000), root("trace-1", NOON)])).toMatchObject({
      traceCount: 2,
      lastTraceAt: NOON + 1000,
    });
  });

  /** @scenario "Folds keyed across aggregates never re-fold from one aggregate's log" */
  it("folds an older trace on as it comes, never re-folding the day from one trace's log", () => {
    expect(fold.options).toMatchObject({ refoldOnOutOfOrder: false });
  });
});

describe("the trace-day failures fold", () => {
  const NOON = Date.UTC(2026, 10, 20, 12);
  const { events, fold } = nurturingTraceDayFailuresFold(
    MemoryNurturingTraceDayRepository.create().forSource("failures"),
  );
  const [{ data: failedSchema }] = events;
  const failedOf = (raw: ReturnType<typeof traceFailed>) => ({
    ...raw,
    tenantId: createTenantId(raw.tenantId),
    type: TRACE_FAILED_EVENT_TYPE,
    data: failedSchema.parse(raw.data),
  });

  /** @scenario "A failed trace is counted from trace's trace_failed fact" */
  it("counts each trace_failed on its project's day of append, with the newest time", () => {
    const first = failedOf(traceFailed({ id: "trace-1", createdAt: NOON }));
    const second = failedOf(traceFailed({ id: "trace-2", createdAt: NOON + 1000 }));

    expect(fold.key?.(first)).toBe(JSON.stringify(["project-1", "2026-11-20"]));
    expect(fold.apply(fold.apply(fold.init(), second), first)).toEqual({
      projectId: "project-1",
      day: "2026-11-20",
      traceCount: 0,
      errorCount: 2,
      lastTraceAt: null,
      lastFailedTraceAt: NOON + 1000,
    });
  });

  /** @scenario "The spans and failures folds keep their own rows of a day, which the read sums" */
  it("keys a failure on the same project and day as the spans fold, in rows of its own source", () => {
    const spans = nurturingTraceDaySpansFold(KEEP_NOTHING).fold;
    const failure = failedOf(traceFailed({ id: "trace-1", createdAt: NOON }));
    const span = {
      ...spanReceived({ id: "trace-1", createdAt: NOON }),
      tenantId: createTenantId("project-1"),
      type: SPAN_RECEIVED_EVENT_TYPE,
      data: { span: { parentSpanId: null } },
    };

    expect(fold.key?.(failure)).toBe(spans.key?.(span));
    expect(fold.name).not.toBe(spans.name);
  });

  /** @scenario "Sample and Langy traces are not counted" */
  it("stages and counts no failure of a sample or Langy trace", () => {
    const of = (origin?: string) =>
      failedOf(traceFailed({ id: "trace-1", createdAt: NOON, origin }));
    const filter = fold.options?.enqueue?.filter;

    expect(filter?.(of("sample"))).toBe(false);
    expect(filter?.(of("langy"))).toBe(false);
    expect(filter?.(of())).toBe(true);
    expect(fold.apply(fold.init(), of("langy")).errorCount).toBe(0);
  });
});

describe("nurturing's member copy", () => {
  const memberFact = (
    type: string,
    organizationId: string,
    occurredAt: number,
    extra: Readonly<Record<string, unknown>> = {},
  ) =>
    ownerFact({
      type,
      aggregateType: ORGANIZATION_AGGREGATE_TYPE,
      aggregateId: organizationId,
      tenantId: organizationId,
      data: {
        tenantId: organizationId,
        organizationId,
        userId: "user-1",
        organizationName: "Acme",
        occurredAt,
        ...extra,
      },
    });
  const copyOver = (members: MemoryNurturingOrganizationMemberRepository) =>
    liveMapsOver({ ...copiesOver(MemoryNurturingRepositories.create()), members });
  const byOrganization = (memberships: readonly NurturingMembership[]) =>
    memberships.toSorted((a, b) => a.organizationId.localeCompare(b.organizationId));

  /** @scenario "Nurturing keeps its own copy of an organization's members" */
  it("keeps each change's latest time, whatever the order or how often it is delivered", async () => {
    const members = MemoryNurturingOrganizationMemberRepository.create();
    const copy = copyOver(members);

    await copy(memberFact(ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE, "org-1", 3_000));
    await copy(memberFact(ORGANIZATION_SIGNED_UP_EVENT_TYPE, "org-1", 1_000));
    await copy(memberFact(ORGANIZATION_SIGNED_UP_EVENT_TYPE, "org-1", 1_000));
    await copy(memberFact(ORGANIZATION_SIGNED_UP_EVENT_TYPE, "org-2", 2_000));

    expect(
      byOrganization(await members.findMembershipsOfMembers({ organizationId: "org-1" })),
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

  /** @scenario "Nurturing keeps its own copy of an organization's members" */
  it("records the founder of a created organization as joined, and no one for a provisioned one", async () => {
    const members = MemoryNurturingOrganizationMemberRepository.create();
    const copy = copyOver(members);
    const created = (organizationId: string, occurredAt: number, userId?: string) =>
      ownerFact({
        type: ORGANIZATION_CREATED_EVENT_TYPE,
        aggregateType: ORGANIZATION_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: organizationId,
        data: {
          tenantId: organizationId,
          organizationId,
          organizationName: "Acme",
          occurredAt,
          ...(userId ? { userId } : {}),
        },
      });

    await copy(created("org-1", 1_000, "user-1"));
    await copy(created("org-1", 1_000, "user-1"));
    await copy(created("org-2", 2_000));

    expect(await members.findMembershipsOfMembers({ organizationId: "org-1" })).toEqual([
      {
        organizationId: "org-1",
        userId: "user-1",
        joinedAt: 1_000,
        leftAt: null,
        returnedAt: null,
      },
    ]);
    expect(await members.findMembershipsOfMembers({ organizationId: "org-2" })).toEqual([]);
  });

  /** @scenario "Nurturing keeps its own copy of an organization's members" */
  it("joins a listed member at the time organization's membership row was created", async () => {
    const members = MemoryNurturingOrganizationMemberRepository.create();
    const copy = copyOver(members);

    await copy(
      memberFact(ORGANIZATION_MEMBER_LISTED_EVENT_TYPE, "org-1", 9_000, {
        joinedAt: 1_500,
        backfilled: true,
      }),
    );
    await copy(memberFact(ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE, "org-1", 4_000));
    await copy(memberFact(ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE, "org-1", 3_000));

    expect(await members.findMembershipsOfMembers({ organizationId: "org-1" })).toEqual([
      {
        organizationId: "org-1",
        userId: "user-1",
        joinedAt: 1_500,
        leftAt: 3_000,
        returnedAt: 4_000,
      },
    ]);
  });
});
