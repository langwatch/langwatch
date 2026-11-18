// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingApi, NurturingServerConfig } from "@langwatch/enterprise-nurturing-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { NurturingModule } from "./app/nurturing.app.ts";
import { nurturingChannels } from "./channels/nurturing-channels.registry.ts";
import { nurturingProjectUsageEventing } from "./eventing/nurturing-project-usage.pipeline.ts";
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
  .withTasks(({ repositories }) => [
    NurturingMemberBackfillTask.create({
      peers: { source: repositories.memberSource, members: repositories.members },
    }),
  ]);
