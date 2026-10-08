// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SaasApi, SaasServerConfig } from "@langwatch/enterprise-saas-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { SaasModule } from "./app/saas.app.ts";
import { saasChannels } from "./channels/saas-channels.registry.ts";
import { saasRepositories } from "./repositories/saas-repositories.registry.ts";
import { usageReportRest } from "./transport/usage-report.rest.ts";

export const saasProcessModule: PublishedProcessModule<"saas", SaasApi, SaasServerConfig> =
  defineProcessModule("saas")
    .withRepositories(saasRepositories)
    .withChannels(saasChannels)
    .withApi(SaasModule)
    .withTransports(usageReportRest);
