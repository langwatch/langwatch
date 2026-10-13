// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingApi, NurturingServerConfig } from "@langwatch/enterprise-nurturing-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { NurturingModule } from "./app/nurturing.app.ts";
import { nurturingChannels } from "./channels/nurturing-channels.registry.ts";
import { nurturingEventing } from "./eventing/nurturing.pipeline.ts";
import { nurturingRepositories } from "./repositories/nurturing-repositories.registry.ts";

export const nurturingProcessModule: PublishedProcessModule<
  "nurturing",
  NurturingApi,
  NurturingServerConfig
> = defineProcessModule("nurturing")
  .withRepositories(nurturingRepositories)
  .withChannels(nurturingChannels)
  .withApi(NurturingModule)
  .withEventing(nurturingEventing);
