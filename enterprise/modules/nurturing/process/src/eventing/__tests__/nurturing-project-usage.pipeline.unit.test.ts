// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  EVALUATOR_CREATED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
} from "@langwatch/evaluator-contract";
import type { Event } from "@langwatch/eventing";
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
import { describe, expect, it } from "vitest";

import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import type { NurturingProjectUsageOwner } from "../../repositories/nurturing-project-usage.repository.ts";
import {
  evaluationDayKeyOf,
  type NurturingProjectUsagePeerEvent,
  nurturingProjectUsagePeerFold,
  projectIdOf,
  projectUsageFactOf,
  traceSyncKeyOf,
} from "../nurturing-project-usage.pipeline.ts";

const OCCURRED_AT = 1_000;

/** An owner event as the peer fold receives it, on tenant `project-1`. */
function ownerEvent(type: string, data: Record<string, unknown>): NurturingProjectUsagePeerEvent {
  return {
    id: `${type}-event`,
    aggregateId: "aggregate-1",
    aggregateType: "owner",
    tenantId: "project-1",
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type,
    version: "2026-11-09",
    data,
  } as unknown as NurturingProjectUsagePeerEvent;
}

const promptCreated = ownerEvent(PROMPT_CREATED_EVENT_TYPE, {
  promptId: "p1",
  projectId: "project-1",
  userId: "user-1",
  orgPromptCount: 1,
  occurredAt: OCCURRED_AT,
});
const promptVersionSaved = ownerEvent(PROMPT_VERSION_SAVED_EVENT_TYPE, {
  promptId: "p1",
  projectId: "project-1",
  versionId: "v2",
  occurredAt: OCCURRED_AT,
});
const promptDeleted = ownerEvent(PROMPT_DELETED_EVENT_TYPE, {
  promptId: "p1",
  projectId: "project-1",
  occurredAt: OCCURRED_AT,
});
const evaluatorCreated = ownerEvent(EVALUATOR_CREATED_EVENT_TYPE, {
  tenantId: "project-1",
  projectId: "project-1",
  evaluatorId: "e1",
  occurredAt: OCCURRED_AT,
});
const evaluatorDeleted = ownerEvent(EVALUATOR_DELETED_EVENT_TYPE, {
  tenantId: "project-1",
  projectId: "project-1",
  evaluatorId: "e1",
  occurredAt: OCCURRED_AT,
});
const scenarioCreated = ownerEvent(SCENARIO_CREATED_EVENT_TYPE, {
  scenarioId: "s1",
  projectId: "project-1",
  userId: "user-1",
  scenarioCount: 3,
  occurredAt: OCCURRED_AT,
});
const simulationSetCreated = ownerEvent(SIMULATION_SET_CREATED_EVENT_TYPE, {
  scenarioSetId: "set-1",
  projectId: "project-1",
  occurredAt: OCCURRED_AT,
});
const simulationFinished = ownerEvent(SIMULATION_RUN_EVENT_TYPES.FINISHED, {
  scenarioRunId: "run-1",
});

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
    const elsewhere = ownerEvent(PROMPT_CREATED_EVENT_TYPE, {
      promptId: "p1",
      projectId: "project-2",
      userId: "user-1",
      orgPromptCount: 1,
      occurredAt: OCCURRED_AT,
    });

    expect(projectIdOf(elsewhere)).toBe("project-2");
    expect(projectIdOf(simulationFinished)).toBe("project-1");
  });
});

/** A peer fact as a subscriber's dedup reads it. */
const peerFact = (data: Record<string, unknown>, occurredAt = OCCURRED_AT) =>
  ({ ...ownerEvent("peer", data), occurredAt }) as unknown as Event;

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
});
