// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What nurturing declares for its personal-project, traced-project and last-trace copies: the
 * retired subscriber lanes' aliases, the replay steps and their order, and the last-trace write.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createTenantId, type ProjectionLaneReplayer } from "@langwatch/eventing";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it, vi } from "vitest";

import { nurturingProcessModule } from "../../nurturing.module.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingLastTracesMap,
} from "../nurturing-project-usage.pipeline.ts";
import { buildNurturingPipeline } from "../nurturing.pipeline.ts";
import {
  LAST_TRACES_SINCE,
  LAST_TRACES_STEP,
  MARKS_STEPS,
  PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
  PERSONAL_OWNERS_OF_PROJECT_STEP,
  PROJECT_LISTING_STEP,
  projectCopiesReplayStepsOver,
  TRACED_PROJECTS_OF_PROJECT_STEP,
  TRACED_PROJECTS_OF_TRACE_STEP,
} from "./nurturing-project-copies.test-helpers.ts";

const RETIRED_LANES = [
  "personalTeamCreated",
  "personalWorkspaceProvisioned",
  "personalOwnerListed",
  "projectTraced",
  "firstMessageListed",
];

describe("the five subscriber lanes the personal-project and traced-project maps replace", () => {
  const host = () => {
    const repositories = MemoryNurturingRepositories.create();
    return buildNurturingProjectUsagePipeline({
      store: repositories.projectUsage,
      evaluationDays: repositories.evaluationDays,
      traceDays: repositories.traceDays,
      copies: {
        placements: repositories.placements,
        organizationsCreated: repositories.organizationsCreated,
        admins: repositories.milestones,
        members: repositories.members,
        virtualKeys: repositories.virtualKeys,
        personalProjects: repositories.personalProjects,
        tracedProjects: repositories.tracedProjects,
        lastTraces: repositories.milestones,
      },
      plans: { store: repositories.plans, deliver: async () => undefined },
      sync: undefined,
    });
  };

  /** @scenario "Jobs the previous release queued under a retired copy lane reach its successor map" */
  it("is aliased from its old lane key to the map that records the same fact", () => {
    const aliases = (host().laneAliases ?? []).filter((alias) =>
      RETIRED_LANES.some((name) => alias.from === `global:subscriber:nurturing.${name}`),
    );

    const routed = Object.fromEntries(
      aliases.map((alias) => [
        alias.from.split(".").at(-1),
        "to" in alias ? alias.to.lane : "tombstone",
      ]),
    );
    expect(routed).toEqual({
      personalTeamCreated: "personalOwnersOfOrganization",
      personalWorkspaceProvisioned: "personalOwnersOfOrganization",
      personalOwnerListed: "personalOwnersOfProject",
      projectTraced: "tracedProjectsOfTrace",
      firstMessageListed: "tracedProjectsOfProject",
    });
    // Each successor is a registered map lane of the host, reached as a handler job.
    const lanes = (host().globalProjections ?? []).map(({ name }) => name);
    for (const alias of aliases) expect(alias).toMatchObject({ to: { jobType: "handler" } });
    for (const lane of Object.values(routed)) {
      expect(lanes).toContain(`${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${String(lane)}`);
    }
  });

  /** @scenario "Jobs the previous release queued under a retired copy lane reach its successor map" */
  it("is no lane of nurturing's own pipeline any more", () => {
    const pipeline = buildNurturingPipeline({
      deliver: async () => undefined,
      organizationMembers: async () => [],
      guidedTurnFailed: async () => undefined,
      usageReportReceived: async () => undefined,
      evaluationsCompleted: async () => undefined,
      simulationRunsFinished: async () => undefined,
      codingSessionsStored: async () => undefined,
      forgetErasedUser: async () => undefined,
      virtualKeyCreated: async () => undefined,
      keyBudgetCrossed: async () => undefined,
      keyFirstRequested: async () => undefined,
      unbudgetedSpendRecorded: async () => undefined,
      governanceSourceConnected: async () => undefined,
      governanceSourceLive: async () => undefined,
    });

    const lanes = (pipeline.globalProjections ?? []).map(({ name }) => name);
    for (const retired of RETIRED_LANES) expect(lanes).not.toContain(`nurturing.${retired}`);
  });

  /** @scenario "A copy lane is registered whether or not a channel syncs" */
  it("registers the five new maps beside the other copies", () => {
    const lanes = (host().globalProjections ?? []).map(({ name }) => name);

    for (const name of [
      "personalOwnersOfOrganization",
      "personalOwnersOfProject",
      "tracedProjectsOfTrace",
      "tracedProjectsOfProject",
      "lastTraces",
    ]) {
      expect(lanes).toContain(`${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${name}`);
    }
  });
});

/** Answers every lane with an empty replay, remembering the lanes asked for and the `since`. */
function recordingReplayer() {
  const asked: { lane: string; since: string }[] = [];
  const replayer: ProjectionLaneReplayer = {
    async replayLane({ lane, since }) {
      asked.push({ lane, since });
      return { lane, kind: "map", aggregatesReplayed: 0, totalEvents: 0, replayedThrough: "1" };
    },
  };
  return { asked, replayer };
}

describe("the replay steps nurturing declares for these copies", () => {
  const COPY_STEPS = [
    PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
    PERSONAL_OWNERS_OF_PROJECT_STEP,
    TRACED_PROJECTS_OF_TRACE_STEP,
    TRACED_PROJECTS_OF_PROJECT_STEP,
    LAST_TRACES_STEP,
  ];

  async function declared() {
    const recording = recordingReplayer();
    const state = await nurturingProcessModule.install({
      resources: new ResourceScope(),
      config: {
        customerIoRegion: void 0,
        customerIoBaseUrl: void 0,
        posthogKey: void 0,
        posthogHost: void 0,
      },
      repositorySelection: { tier: "memory", members: {} },
      role: "worker",
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
      replayer: recording.replayer,
      resolve: () => createApiFixture<never>(),
    });
    const steps = (state.migrationSteps ?? [])
      .filter(isMigrationStep)
      .filter(({ id }) => COPY_STEPS.includes(id));
    return { steps, recording };
  }

  /** @scenario "The copy steps run after the erasure marks and project's listing step" */
  it("pins each step's order: owners after the marks, project lanes after project's listing", async () => {
    const { steps } = await declared();
    const pinned = projectCopiesReplayStepsOver(recordingReplayer().replayer);

    expect(steps.map(({ id }) => id)).toEqual(COPY_STEPS);
    expect(Object.fromEntries(steps.map(({ id, after }) => [id, after]))).toEqual({
      [PERSONAL_OWNERS_OF_ORGANIZATION_STEP]: [...MARKS_STEPS],
      [PERSONAL_OWNERS_OF_PROJECT_STEP]: [...MARKS_STEPS, PROJECT_LISTING_STEP],
      [TRACED_PROJECTS_OF_TRACE_STEP]: undefined,
      [TRACED_PROJECTS_OF_PROJECT_STEP]: [PROJECT_LISTING_STEP],
      [LAST_TRACES_STEP]: undefined,
    });
    for (const [index, step] of steps.entries()) {
      expect(step).toMatchObject({
        id: pinned[index]?.id,
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
        description: pinned[index]?.description,
      });
    }
  });

  /** @scenario "The last-trace replay starts the day before the release" */
  it("replays only the last-trace lane from the day before the release", async () => {
    const { steps, recording } = await declared();

    for (const step of steps) {
      await step.run({
        log: { info: () => undefined, warn: () => undefined },
        checkpoint: { resumeFrom: null, save: async () => undefined },
        dryRun: false,
        signal: new AbortController().signal,
      });
    }

    const sinceOf = (projection: string) =>
      recording.asked.find(({ lane }) => lane.endsWith(`.${projection}`))?.since;
    expect(sinceOf("lastTraces")).toBe(LAST_TRACES_SINCE);
    expect(sinceOf("personalOwnersOfOrganization")).toBe("1970-01-01T00:00:00Z");
  });

  /** @scenario "The copy steps run after the erasure marks and project's listing step" */
  it("lists the five ids in the image's code steps", () => {
    const codeSteps = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../../../packages/upgrade/releases/image/code-steps.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as { id: string }[];

    const ids = codeSteps.map(({ id }) => id);
    for (const id of COPY_STEPS) expect(ids).toContain(id);
  });
});

describe("the last-trace copy", () => {
  const traceFact = (
    organizationId: string | undefined,
    occurredAt: number,
    projectId = "project-1",
  ) => ({
    type: TRACE_RECEIVED_EVENT_TYPE,
    tenantId: createTenantId(projectId),
    data: { tenantId: projectId, projectId, userId: "admin-1", occurredAt, organizationId },
  });

  /** @scenario "Five hundred trace facts of one organization are one write of the latest time" */
  it("writes the latest of 500 facts through one bulk call and one store write", async () => {
    const lastTraces = { recordLastTrace: vi.fn(async () => undefined) };
    const { map } = nurturingLastTracesMap(lastTraces);
    const facts = Array.from({ length: 500 }, (_, index) => traceFact("org-1", 1_000 + index));
    const records = facts.flatMap((fact) => map.map(fact as never) ?? []);

    await map.store.bulkAppend?.(records, { tenantId: createTenantId("project-1") });

    expect(records).toHaveLength(500);
    expect(lastTraces.recordLastTrace).toHaveBeenCalledTimes(1);
    expect(lastTraces.recordLastTrace).toHaveBeenCalledWith({
      organizationId: "org-1",
      occurredAt: 1_499,
    });
  });

  /** @scenario "Five hundred trace facts of one organization are one write of the latest time" */
  it("coalesces a burst per organization, across its projects, in batches of 500", () => {
    const { map } = nurturingLastTracesMap({ recordLastTrace: async () => undefined });
    const groupOf = (fact: ReturnType<typeof traceFact>) =>
      map.options?.groupKeyFn?.(fact as never);

    expect(map.options?.coalesceMaxBatch).toBe(500);
    expect(groupOf(traceFact("org-1", 1, "project-1"))).toBe(
      groupOf(traceFact("org-1", 2, "project-2")),
    );
    expect(groupOf(traceFact("org-1", 1))).not.toBe(groupOf(traceFact("org-2", 1)));
  });

  /** @scenario "A trace fact naming no organization writes nothing" */
  it("maps a fact with no organization to nothing, and mints no job for it", async () => {
    const lastTraces = { recordLastTrace: vi.fn(async () => undefined) };
    const { map } = nurturingLastTracesMap(lastTraces);
    const fact = traceFact(undefined, 1_000);

    expect(map.map(fact as never)).toBeNull();
    expect(map.options?.enqueue?.filter?.(fact as never)).toBe(false);
    expect(map.options?.enqueue?.filter?.(traceFact("org-1", 1_000) as never)).toBe(true);
    expect(lastTraces.recordLastTrace).not.toHaveBeenCalled();
  });

  /** @scenario "A trace fact naming no organization writes nothing" */
  it("takes the first trace and the later traces of a project", () => {
    const { map } = nurturingLastTracesMap({ recordLastTrace: async () => undefined });

    expect(map.eventTypes).toEqual([FIRST_TRACE_RECORDED_EVENT_TYPE, TRACE_RECEIVED_EVENT_TYPE]);
  });
});
