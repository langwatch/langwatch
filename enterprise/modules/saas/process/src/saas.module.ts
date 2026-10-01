// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineProcessModule } from "@langwatch/process";

import { SaasModule } from "./app/saas.app.ts";
import { usageReportRest } from "./transport/usage-report.rest.ts";

export const saasProcessModule = defineProcessModule("saas")
  .withApi(SaasModule)
  .withTransports(usageReportRest);
