// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineProjectionReplayStep,
  type LaneReplayer,
  type MigrationStep,
} from "@langwatch/upgrade/step";

import {
  NURTURING_LAST_TRACES_PROJECTION_NAME,
  NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME,
  NURTURING_PERSONAL_OWNERS_OF_PROJECT_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME,
  NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME,
} from "../nurturing-project-usage.pipeline.ts";
import { IDENTITY_MARKS_STEP, USER_MARKS_STEP } from "./nurturing-replay-steps.test-helpers.ts";

export const PERSONAL_OWNERS_OF_ORGANIZATION_STEP =
  "nurturing:replay-personal-owners-from-organization";
export const PERSONAL_OWNERS_OF_PROJECT_STEP = "nurturing:replay-personal-owners-from-project";
export const TRACED_PROJECTS_OF_TRACE_STEP = "nurturing:replay-traced-projects-from-trace";
export const TRACED_PROJECTS_OF_PROJECT_STEP = "nurturing:replay-traced-projects-from-project";
export const LAST_TRACES_STEP = "nurturing:replay-last-traces";
/** Project's own listing step, whose facts the two project lanes replay. */
export const PROJECT_LISTING_STEP = "project:list-personal-owner-and-first-message-facts";

export const MARKS_STEPS = [USER_MARKS_STEP, IDENTITY_MARKS_STEP] as const;

/** The release's date less a day, as nurturing.module.ts pins it for the last-trace replay. */
export const LAST_TRACES_SINCE = "2026-11-18T00:00:00Z";

const laneOf = (projection: string) => `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${projection}`;

/**
 * The personal-project, traced-project and last-trace steps as nurturing.module.ts declares them,
 * rebuilt over a test's own replayer from the same pinned ids and lane constants. The declaration
 * test compares the module against this.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
export function projectCopiesReplayStepsOver(replayer: LaneReplayer): MigrationStep[] {
  const common = { needsOldWritersGone: true, trailingPass: true, replayer } as const;
  return [
    defineProjectionReplayStep({
      ...common,
      id: PERSONAL_OWNERS_OF_ORGANIZATION_STEP,
      description:
        "Fills nurturing's personal-project owners from organization's personal-workspace log at deploy.",
      lane: laneOf(NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME),
      after: MARKS_STEPS,
    }),
    defineProjectionReplayStep({
      ...common,
      id: PERSONAL_OWNERS_OF_PROJECT_STEP,
      description:
        "Fills nurturing's personal-project owners from the owners project listed at deploy.",
      lane: laneOf(NURTURING_PERSONAL_OWNERS_OF_PROJECT_PROJECTION_NAME),
      after: [...MARKS_STEPS, PROJECT_LISTING_STEP],
    }),
    defineProjectionReplayStep({
      ...common,
      id: TRACED_PROJECTS_OF_TRACE_STEP,
      description: "Fills nurturing's traced projects from trace's project_traced log at deploy.",
      lane: laneOf(NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME),
    }),
    defineProjectionReplayStep({
      ...common,
      id: TRACED_PROJECTS_OF_PROJECT_STEP,
      description:
        "Fills nurturing's traced projects from the first messages project listed at deploy.",
      lane: laneOf(NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME),
      after: [PROJECT_LISTING_STEP],
    }),
    defineProjectionReplayStep({
      ...common,
      id: LAST_TRACES_STEP,
      description:
        "Fills each organization's latest trace time from trace's facts since the day before the release.",
      lane: laneOf(NURTURING_LAST_TRACES_PROJECTION_NAME),
      since: LAST_TRACES_SINCE,
    }),
  ];
}
