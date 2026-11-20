// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingApi, NurturingServerConfig } from "@langwatch/enterprise-nurturing-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineProjectionReplayStep } from "@langwatch/upgrade/step";

import { NurturingModule } from "./app/nurturing.app.ts";
import { nurturingChannels } from "./channels/nurturing-channels.registry.ts";
import {
  NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_VIRTUAL_KEYS_PROJECTION_NAME,
  nurturingProjectUsageEventing,
} from "./eventing/nurturing-project-usage.pipeline.ts";
import { nurturingTraceWindowEndEventing } from "./eventing/nurturing-trace-window-end.pipeline.ts";
import { nurturingEventing } from "./eventing/nurturing.pipeline.ts";
import { nurturingRepositories } from "./repositories/nurturing-repositories.registry.ts";
import { NurturingMemberBackfillTask } from "./tasks/nurturing-member-backfill.task.ts";

export const nurturingProcessModule: PublishedProcessModule<
  "nurturing",
  NurturingApi,
  NurturingServerConfig
> = defineProcessModule("nurturing")
  .withRepositories(nurturingRepositories)
  .withChannels(nurturingChannels)
  .withApi(NurturingModule)
  .withEventing(nurturingEventing)
  .withEventing(nurturingProjectUsageEventing)
  .withEventing(nurturingTraceWindowEndEventing)
  // Hand-run after the rollout, dry run unless --execute: the member copy was never backfilled.
  .withTasks(({ repositories, dependencies }) => [
    NurturingMemberBackfillTask.create({
      peers: {
        organizations: dependencies.organizations,
        source: repositories.memberSource,
        members: repositories.members,
      },
    }),
  ])
  // Deploy-time fills from its owners' logs: the erasure marks of both erasure sources, then the
  // key copy, which runs `after` them so a key copied from old facts finds every erased person
  // marked. Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
  .withMigrations(({ replayer }) => [
    defineProjectionReplayStep({
      id: "nurturing:replay-user-erasure-marks",
      description: "Marks every person erased in user's log, before the keys copy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-identity-erasure-marks",
      description: "Marks every person erased in identity's log, before the keys copy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-virtual-keys",
      description: "Fills nurturing's key copy from gateway's key lifecycle log at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_VIRTUAL_KEYS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: ["nurturing:replay-user-erasure-marks", "nurturing:replay-identity-erasure-marks"],
      replayer,
    }),
  ]);
