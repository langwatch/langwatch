// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineProjectionReplayStep,
  type LaneReplayer,
  type MigrationStep,
} from "@langwatch/upgrade/step";

import {
  NURTURING_EVALUATION_DAYS_PROJECTION_NAME,
  NURTURING_EVALUATION_DAYS_REPLAY_SINCE,
  NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_ORGANIZATION_PLANS_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_VIRTUAL_KEYS_PROJECTION_NAME,
} from "../nurturing-project-usage.pipeline.ts";

export const USER_MARKS_STEP = "nurturing:replay-user-erasure-marks";
export const IDENTITY_MARKS_STEP = "nurturing:replay-identity-erasure-marks";
export const KEYS_STEP = "nurturing:replay-virtual-keys";
export const EVALUATION_DAYS_STEP = "nurturing:replay-evaluation-days";
export const PLANS_STEP = "nurturing:replay-organization-plans";

const laneOf = (projection: string) => `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${projection}`;

/**
 * The replay steps as nurturing.module.ts declares them, rebuilt over a test's own replayer
 * from the same pinned ids and lane constants. The module's declaration test compares the module
 * against this, so a lane or ordering change in one place fails there rather than diverging.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
export function nurturingReplayStepsOver(replayer: LaneReplayer): MigrationStep[] {
  const marks = [
    defineProjectionReplayStep({
      id: USER_MARKS_STEP,
      description: "Marks every person erased in user's log, before the keys copy.",
      lane: laneOf(NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME),
      trailingPass: true,
      replayer,
    }),
    defineProjectionReplayStep({
      id: IDENTITY_MARKS_STEP,
      description: "Marks every person erased in identity's log, before the keys copy.",
      lane: laneOf(NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME),
      trailingPass: true,
      replayer,
    }),
  ];
  return [
    ...marks,
    defineProjectionReplayStep({
      id: KEYS_STEP,
      description: "Fills nurturing's key copy from gateway's key lifecycle log at deploy.",
      lane: laneOf(NURTURING_VIRTUAL_KEYS_PROJECTION_NAME),
      trailingPass: true,
      after: marks,
      replayer,
    }),
    defineProjectionReplayStep({
      id: EVALUATION_DAYS_STEP,
      description: "Fills nurturing's evaluation days from evaluation's log since 2026-10-19.",
      lane: laneOf(NURTURING_EVALUATION_DAYS_PROJECTION_NAME),
      since: NURTURING_EVALUATION_DAYS_REPLAY_SINCE,
      trailingPass: true,
      replayer,
    }),
    defineProjectionReplayStep({
      id: PLANS_STEP,
      description: "Fills nurturing's plan copy from billing's subscription log; sends nothing.",
      lane: laneOf(NURTURING_ORGANIZATION_PLANS_PROJECTION_NAME),
      trailingPass: true,
      replayer,
    }),
  ];
}
