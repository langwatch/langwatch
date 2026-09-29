// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/kernel";

import { NurturingApp } from "./app/nurturing.app.ts";
import { nurturingEventing } from "./eventing/nurturing.pipeline.ts";

export const nurturingServer = defineServerModule("nurturing")
  .withApp(NurturingApp)
  .withEventing(nurturingEventing);
