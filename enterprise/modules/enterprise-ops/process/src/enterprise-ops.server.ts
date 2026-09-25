// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/kernel";

import { EnterpriseOpsApp } from "./app/enterprise-ops.app.ts";
import { licenseRegistryTrpcTransport } from "./transport/license-registry.trpc.ts";
import { selfHostedInstancesTrpcTransport } from "./transport/self-hosted-instance.trpc.ts";

export const enterpriseOpsServer = defineServerModule("enterprise-ops")
  .withApp(EnterpriseOpsApp)
  .withTransports(licenseRegistryTrpcTransport, selfHostedInstancesTrpcTransport);
