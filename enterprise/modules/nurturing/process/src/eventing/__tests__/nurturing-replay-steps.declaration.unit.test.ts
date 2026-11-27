// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The replay steps nurturing.module.ts declares, against the steps the behaviour tests build from
 * the same pinned ids and lane constants: a module-side change to either breaks here.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ProjectionLaneReplayer } from "@langwatch/eventing";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  isMigrationStep,
  type MigrationStep,
  QUEUE_TENANT_CLAIMS_FILL_STEP,
} from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { nurturingProcessModule } from "../../nurturing.module.ts";
import {
  ADMINS_STEP,
  AUTH_MEMBERS_STEP,
  MEMBER_LISTING_STEP,
  MEMBERS_STEP,
  ORGANIZATIONS_CREATED_STEP,
  organizationCopiesReplayStepsOver,
  PLACEMENTS_STEP,
  PROJECT_CREATED_FACTS_STEP,
} from "./nurturing-organization-copies.test-helpers.ts";
import {
  LAST_TRACES_STEP,
  PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
  PERSONAL_OWNERS_OF_PROJECT_STEP,
  PROJECT_LISTING_STEP,
  projectCopiesReplayStepsOver,
  TRACED_PROJECTS_OF_PROJECT_STEP,
  TRACED_PROJECTS_OF_TRACE_STEP,
} from "./nurturing-project-copies.test-helpers.ts";
import {
  EVALUATION_DAYS_STEP,
  IDENTITY_MARKS_STEP,
  KEYS_STEP,
  nurturingReplayStepsOver,
  PLANS_STEP,
  USER_MARKS_STEP,
} from "./nurturing-replay-steps.test-helpers.ts";
import {
  TRACE_DAY_FAILURES_STEP,
  TRACE_DAY_SPANS_STEP,
  traceDayReplayStepsOver,
} from "./nurturing-trace-days.test-helpers.ts";

const CODE_STEPS_JSON = fileURLToPath(
  new URL("../../../../../../../packages/upgrade/releases/image/code-steps.json", import.meta.url),
);

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
  it("declares the marks steps, then each copy after the steps it reads, on the lanes the behaviour tests pin", async () => {
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
    const expected = [
      ...nurturingReplayStepsOver(pinned.replayer),
      ...organizationCopiesReplayStepsOver(pinned.replayer),
      ...projectCopiesReplayStepsOver(pinned.replayer),
      ...traceDayReplayStepsOver(pinned.replayer),
    ];

    expect(steps.map(({ id }) => id)).toEqual([
      USER_MARKS_STEP,
      IDENTITY_MARKS_STEP,
      KEYS_STEP,
      EVALUATION_DAYS_STEP,
      PLANS_STEP,
      PLACEMENTS_STEP,
      ORGANIZATIONS_CREATED_STEP,
      ADMINS_STEP,
      MEMBERS_STEP,
      AUTH_MEMBERS_STEP,
      PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
      PERSONAL_OWNERS_OF_PROJECT_STEP,
      TRACED_PROJECTS_OF_TRACE_STEP,
      TRACED_PROJECTS_OF_PROJECT_STEP,
      LAST_TRACES_STEP,
      TRACE_DAY_SPANS_STEP,
      TRACE_DAY_FAILURES_STEP,
    ]);
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
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [USER_MARKS_STEP, IDENTITY_MARKS_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [PROJECT_CREATED_FACTS_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [
        USER_MARKS_STEP,
        IDENTITY_MARKS_STEP,
        PROJECT_CREATED_FACTS_STEP,
        QUEUE_TENANT_CLAIMS_FILL_STEP,
      ],
      [USER_MARKS_STEP, IDENTITY_MARKS_STEP, MEMBER_LISTING_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
      [USER_MARKS_STEP, IDENTITY_MARKS_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
      [USER_MARKS_STEP, IDENTITY_MARKS_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
      [USER_MARKS_STEP, IDENTITY_MARKS_STEP, PROJECT_LISTING_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [PROJECT_LISTING_STEP, QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
      [QUEUE_TENANT_CLAIMS_FILL_STEP],
    ]);
    // The image ships code-steps.json, not this declaration: a stale list breaks here too.
    const codeSteps = JSON.parse(readFileSync(CODE_STEPS_JSON, "utf8")) as { id: string }[];
    const shippedIds = codeSteps.map(({ id }) => id).filter((id) => id.startsWith("nurturing:"));
    expect(shippedIds).toEqual(steps.map(({ id }) => id));

    // The lane and the trailing pass are only observable by running: each step asks for its lane twice.
    for (const step of steps) await runOnce(step);
    for (const step of expected) await runOnce(step);
    expect(declared.lanes).toHaveLength(2 * steps.length);
    expect(declared.lanes).toEqual(pinned.lanes);
    expect(new Set(declared.lanes).size).toBe(steps.length);
  });
});
