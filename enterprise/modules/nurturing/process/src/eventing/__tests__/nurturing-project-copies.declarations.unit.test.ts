// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What nurturing declares for its personal-project, traced-project and last-trace copies: the
 * retired subscriber lanes' aliases, the replay steps and their order, and the last-trace write.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ProjectionLaneReplayer } from "@langwatch/eventing";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { nurturingProcessModule } from "../../nurturing.module.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
} from "../nurturing-project-usage.pipeline.ts";
import { buildNurturingPipeline } from "../nurturing.pipeline.ts";
import {
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
      copies: {
        placements: repositories.placements,
        copyLanded: async () => undefined,
        organizationsCreated: repositories.organizationsCreated,
        admins: repositories.milestones,
        members: repositories.members,
        virtualKeys: repositories.virtualKeys,
        personalProjects: repositories.personalProjects,
        tracedProjects: repositories.tracedProjects,
      },
      sync: undefined,
    });
  };

  /** @scenario "Jobs the previous release queued under a retired copy lane reach its successor map" */
  it("is aliased from its old lane key to the map that records the same fact", () => {
    const aliases = (host().laneAliases ?? []).filter((alias) =>
      RETIRED_LANES.some((name) => alias.from === `global:subscriber:nurturing.${name}`),
    );

    const routed = Object.fromEntries(
      aliases
        .map((alias) => [alias.from.split(".").at(-1), "to" in alias ? alias.to.lane : "tombstone"]),
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
    for (const alias of aliases) {
      expect(alias).not.toHaveProperty("tombstone");
      if ("to" in alias) {
        expect(alias.to.jobType).toBe("handler");
        expect(lanes).toContain(`${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${alias.to.lane}`);
      }
    }
  });

  /** @scenario "Jobs the previous release queued under a retired copy lane reach its successor map" */
  it("is no lane of nurturing's own pipeline any more", () => {
    const pipeline = buildNurturingPipeline({
      deliver: async () => undefined,
      guidedTurnFailed: async () => undefined,
      usageReportReceived: async () => undefined,
      evaluationsCompleted: async () => undefined,
      simulationRunsFinished: async () => undefined,
      codingSessionsStored: async () => undefined,
      forgetErasedUser: async () => undefined,
      virtualKeyCreated: async () => undefined,
      keyBudgetCrossed: async () => undefined,
    });

    const lanes = (pipeline.globalProjections ?? []).map(({ name }) => name);
    for (const retired of RETIRED_LANES) expect(lanes).not.toContain(`nurturing.${retired}`);
  });

  /** @scenario "A copy lane is registered whether or not a channel syncs" */
  it("registers the four new maps beside the other copies", () => {
    const lanes = (host().globalProjections ?? []).map(({ name }) => name);

    for (const name of [
      "personalOwnersOfOrganization",
      "personalOwnersOfProject",
      "tracedProjectsOfTrace",
      "tracedProjectsOfProject",
    ]) {
      expect(lanes).toContain(`${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${name}`);
    }
  });
});

/** Answers every lane with an empty replay, remembering the lanes asked for. */
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

  /** @scenario "The copy steps run after the erasure marks and project's listing step" */
  it("lists the four ids in the image's code steps", () => {
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
