// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineProcessModule } from "@langwatch/process";

import { EnterpriseOpsModule } from "./app/enterprise-ops.app.ts";
import { licenseRegistryTrpcTransport } from "./transport/license-registry.trpc.ts";
import { selfHostedInstancesTrpcTransport } from "./transport/self-hosted-instance.trpc.ts";

export const enterpriseOpsProcessModule = defineProcessModule("enterprise-ops")
  .withApi(EnterpriseOpsModule)
  .withTransports(licenseRegistryTrpcTransport, selfHostedInstancesTrpcTransport);
