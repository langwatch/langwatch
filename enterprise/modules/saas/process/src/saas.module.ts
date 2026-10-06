// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineProcessModule } from "@langwatch/process";

import { SaasModule } from "./app/saas.app.ts";
import { saasRepositories } from "./repositories/saas-repositories.registry.ts";
import { usageReportRest } from "./transport/usage-report.rest.ts";

export const saasProcessModule = defineProcessModule("saas")
  .withRepositories(saasRepositories)
  .withApi(SaasModule)
  .withTransports(usageReportRest);
