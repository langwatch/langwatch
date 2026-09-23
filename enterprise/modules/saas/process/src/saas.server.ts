// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/kernel";

import { SaasApp } from "./app/saas.app.ts";
import { usageReportRest } from "./transport/usage-report.rest.ts";

export const saasServer = defineServerModule("saas")
  .withApp(SaasApp)
  .withTransports(usageReportRest);
