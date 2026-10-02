// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineProcessModule } from "@langwatch/process";

import { NurturingModule } from "./app/nurturing.app.ts";
import { nurturingEventing } from "./eventing/nurturing.pipeline.ts";
import { nurturingRepositories } from "./repositories/nurturing-repositories.registry.ts";

export const nurturingProcessModule = defineProcessModule("nurturing")
  .withRepositories(nurturingRepositories)
  .withApi(NurturingModule)
  .withEventing(nurturingEventing);
