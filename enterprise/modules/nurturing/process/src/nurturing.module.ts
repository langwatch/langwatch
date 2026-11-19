// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingApi, NurturingServerConfig } from "@langwatch/enterprise-nurturing-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineProjectionReplayStep } from "@langwatch/upgrade/step";

import { NurturingModule } from "./app/nurturing.app.ts";
import { nurturingChannels } from "./channels/nurturing-channels.registry.ts";
import {
  NURTURING_AUTH_MEMBERS_PROJECTION_NAME,
  NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_LAST_TRACES_PROJECTION_NAME,
  NURTURING_ORGANIZATION_ADMINS_PROJECTION_NAME,
  NURTURING_ORGANIZATION_CREATIONS_PROJECTION_NAME,
  NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME,
  NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME,
  NURTURING_PERSONAL_OWNERS_OF_PROJECT_PROJECTION_NAME,
  NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME,
  NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME,
  NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME,
  NURTURING_VIRTUAL_KEYS_PROJECTION_NAME,
  nurturingProjectUsageEventing,
} from "./eventing/nurturing-project-usage.pipeline.ts";
import { nurturingTraceWindowEndEventing } from "./eventing/nurturing-trace-window-end.pipeline.ts";
import { nurturingEventing } from "./eventing/nurturing.pipeline.ts";
import { nurturingRepositories } from "./repositories/nurturing-repositories.registry.ts";

/**
 * The release's date less a day: an organization's trace time older than this is already in its
 * column, and the time only moves forward, so a replay from here loses nothing.
 */
const LAST_TRACES_REPLAY_SINCE = "2026-11-18T00:00:00Z";

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
    // Project's own step records every project it held before it recorded creations.
    defineProjectionReplayStep({
      id: "nurturing:replay-project-placements",
      description:
        "Fills nurturing's project placement copy from project's created facts at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: ["project:record-created-facts"],
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-organizations-created",
      description:
        "Fills nurturing's organization creation copy from organization's log at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_ORGANIZATION_CREATIONS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      replayer,
    }),
    // After the marks, so no admin erased before the copy existed is stored.
    defineProjectionReplayStep({
      id: "nurturing:replay-organization-admins",
      description:
        "Fills each organization's admin and seeded flag from project's created facts at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_ORGANIZATION_ADMINS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: [
        "nurturing:replay-user-erasure-marks",
        "nurturing:replay-identity-erasure-marks",
        "project:record-created-facts",
      ],
      replayer,
    }),
    // Organization's listing step records the members it held before it recorded member facts.
    defineProjectionReplayStep({
      id: "nurturing:replay-organization-members",
      description: "Fills nurturing's member copy from organization's member facts at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: [
        "nurturing:replay-user-erasure-marks",
        "nurturing:replay-identity-erasure-marks",
        "organization:list-member-facts",
      ],
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-auth-members",
      description: "Fills nurturing's member copy from auth's single sign-on joins at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_AUTH_MEMBERS_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: ["nurturing:replay-user-erasure-marks", "nurturing:replay-identity-erasure-marks"],
      replayer,
    }),
    // Personal-project owners read the erasure marks as the key copy does, so they run after them.
    // Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
    defineProjectionReplayStep({
      id: "nurturing:replay-personal-owners-from-organization",
      description:
        "Fills nurturing's personal-project owners from organization's personal-workspace log at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: ["nurturing:replay-user-erasure-marks", "nurturing:replay-identity-erasure-marks"],
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-personal-owners-from-project",
      description:
        "Fills nurturing's personal-project owners from the owners project listed at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_PERSONAL_OWNERS_OF_PROJECT_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: [
        "nurturing:replay-user-erasure-marks",
        "nurturing:replay-identity-erasure-marks",
        "project:list-personal-owner-and-first-message-facts",
      ],
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-traced-projects-from-trace",
      description: "Fills nurturing's traced projects from trace's project_traced log at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-traced-projects-from-project",
      description:
        "Fills nurturing's traced projects from the first messages project listed at deploy.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME}`,
      needsOldWritersGone: true,
      trailingPass: true,
      after: ["project:list-personal-owner-and-first-message-facts"],
      replayer,
    }),
    defineProjectionReplayStep({
      id: "nurturing:replay-last-traces",
      description:
        "Fills each organization's latest trace time from trace's facts since the day before the release.",
      lane: `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_LAST_TRACES_PROJECTION_NAME}`,
      since: LAST_TRACES_REPLAY_SINCE,
      needsOldWritersGone: true,
      trailingPass: true,
      replayer,
    }),
  ]);
