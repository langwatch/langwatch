// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/kernel";

import { EnterpriseGatewayApp } from "./app/enterprise-gateway.app.ts";
import { enterpriseGatewayRepositories } from "./repositories/enterprise-gateway-repositories.registry.ts";
import { personalVirtualKeysTrpcTransport } from "./transport/personal-virtual-keys.trpc.ts";
import { routingPolicyTrpcTransport } from "./transport/routing-policy.trpc.ts";

export const enterpriseGatewayServer = defineServerModule("enterprise-gateway")
  .withRepositories(enterpriseGatewayRepositories)
  .withApp(EnterpriseGatewayApp)
  .withTransports(routingPolicyTrpcTransport, personalVirtualKeysTrpcTransport);
