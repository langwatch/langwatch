// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/process";

import { NurturingApp } from "./app/nurturing.app.ts";
import { nurturingEventing } from "./eventing/nurturing.pipeline.ts";
import { nurturingRepositories } from "./repositories/nurturing-repositories.registry.ts";

export const nurturingServer = defineServerModule("nurturing")
  .withRepositories(nurturingRepositories)
  .withApp(NurturingApp)
  .withEventing(nurturingEventing);
