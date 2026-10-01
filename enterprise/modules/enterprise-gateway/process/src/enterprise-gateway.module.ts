// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineProcessModule } from "@langwatch/process";

import { EnterpriseGatewayModule } from "./app/enterprise-gateway.app.ts";
import { enterpriseGatewayRepositories } from "./repositories/enterprise-gateway-repositories.registry.ts";
import { personalVirtualKeysTrpcTransport } from "./transport/personal-virtual-keys.trpc.ts";
import { routingPolicyTrpcTransport } from "./transport/routing-policy.trpc.ts";

export const enterpriseGatewayProcessModule = defineProcessModule("enterprise-gateway")
  .withRepositories(enterpriseGatewayRepositories)
  .withApi(EnterpriseGatewayModule)
  .withTransports(routingPolicyTrpcTransport, personalVirtualKeysTrpcTransport);
