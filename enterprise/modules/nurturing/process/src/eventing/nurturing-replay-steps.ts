// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineProjectionReplayStep,
  type LaneReplayer,
  type MigrationStep,
} from "@langwatch/upgrade/step";

import {
  NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_VIRTUAL_KEYS_PROJECTION_NAME,
} from "./nurturing-project-usage.pipeline.ts";

const laneOf = (projection: string) => `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${projection}`;

/**
 * Nurturing's deploy-time fills from its owners' logs: the erasure marks of both erasure sources,
 * then the key copy, which runs `after` them so a key copied from old facts finds every erased
 * person marked. Spec: enterprise/modules/nurturing/specs/gateway-facts.feature.
 */
export function nurturingReplaySteps(replayer: LaneReplayer): MigrationStep[] {
  const marks = [
    defineProjectionReplayStep({
      id: "nurturing:replay-user-erasure-marks",
      description: "Marks every person erased in user's log, before the keys copy.",
      lane: laneOf(NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME),
      needsOldWritersGone: true,
      trailingPass: true,
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-identity-erasure-marks",
      description: "Marks every person erased in identity's log, before the keys copy.",
      lane: laneOf(NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME),
      needsOldWritersGone: true,
      trailingPass: true,
      replayer,
    }),
  ];
  return [
    ...marks,
    defineProjectionReplayStep({
      id: "nurturing:replay-virtual-keys",
      description: "Fills nurturing's key copy from gateway's key lifecycle log at deploy.",
      lane: laneOf(NURTURING_VIRTUAL_KEYS_PROJECTION_NAME),
      needsOldWritersGone: true,
      trailingPass: true,
      after: marks,
      replayer,
    }),
  ];
}
