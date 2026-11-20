// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The replay steps nurturing.module.ts declares, against the steps the behaviour tests build from
 * the same pinned ids and lane constants: a module-side change to either breaks here.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import type { ProjectionLaneReplayer } from "@langwatch/eventing";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isMigrationStep, type MigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { nurturingProcessModule } from "../../nurturing.module.ts";
import {
  IDENTITY_MARKS_STEP,
  KEYS_STEP,
  nurturingReplayStepsOver,
  USER_MARKS_STEP,
} from "./nurturing-replay-steps.test-helpers.ts";

/** Answers every lane with an empty replay, remembering the lanes asked for and in what order. */
function recordingReplayer() {
  const lanes: string[] = [];
  const replayer: ProjectionLaneReplayer = {
    async replayLane({ lane }) {
      lanes.push(lane);
      return { lane, kind: "map", aggregatesReplayed: 0, totalEvents: 0, replayedThrough: "1" };
    },
  };
  return { lanes, replayer };
}

/** One real (not dry) run of a step: a trailing pass replays its lane a second time. */
const runOnce = (step: MigrationStep) =>
  step.run({
    log: { info: () => undefined, warn: () => undefined },
    checkpoint: { resumeFrom: null, save: async () => undefined },
    dryRun: false,
    signal: new AbortController().signal,
  });

describe("given the nurturing module installed on a worker", () => {
  it("declares the two erasure marks steps and the key copy after both, on the lanes the behaviour tests pin", async () => {
    const declared = recordingReplayer();
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
      replayer: declared.replayer,
      resolve: () => createApiFixture<never>(),
    });
    const steps = (state.migrationSteps ?? []).filter(isMigrationStep);
    const pinned = recordingReplayer();
    const expected = nurturingReplayStepsOver(pinned.replayer);

    expect(steps.map(({ id }) => id)).toEqual([USER_MARKS_STEP, IDENTITY_MARKS_STEP, KEYS_STEP]);
    for (const [index, step] of steps.entries()) {
      expect(step).toMatchObject({
        id: expected[index]?.id,
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
        description: expected[index]?.description,
      });
      expect(step.after).toEqual(expected[index]?.after);
    }
    expect(steps.map(({ after }) => after)).toEqual([
      undefined,
      undefined,
      [USER_MARKS_STEP, IDENTITY_MARKS_STEP],
    ]);

    // The lane and the trailing pass are only observable by running: each step asks for its lane twice.
    for (const step of steps) await runOnce(step);
    for (const step of expected) await runOnce(step);
    expect(declared.lanes).toHaveLength(6);
    expect(declared.lanes).toEqual(pinned.lanes);
    expect(new Set(declared.lanes).size).toBe(3);
  });
});
