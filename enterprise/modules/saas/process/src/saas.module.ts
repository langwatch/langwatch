// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { callerAddressOfRequest } from "@langwatch/api/rest";
import type { SaasApi, SaasServerConfig } from "@langwatch/enterprise-saas-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { SaasModule } from "./app/saas.app.ts";
import { saasUsageReportEventing } from "./eventing/saas-usage-report.pipeline.ts";
import { saasRepositories } from "./repositories/saas-repositories.registry.ts";
import { usageReportRest } from "./transport/usage-report.rest.ts";

export const saasProcessModule: PublishedProcessModule<"saas", SaasApi, SaasServerConfig> =
  defineProcessModule("saas")
    .withRepositories(saasRepositories)
    .withApi(SaasModule)
    .withTransports(usageReportRest)
    .provideMiddlewareContext({ callerAddress: callerAddressOfRequest })
    .withEventing(saasUsageReportEventing);
