// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineRepositories } from "@langwatch/kernel";

import { MemoryEnterpriseGatewayRepositories } from "./memory/memory.enterprise-gateway.repositories.ts";
import { PrismaEnterpriseGatewayRepositories } from "./prisma/prisma.enterprise-gateway.repositories.ts";

export const enterpriseGatewayRepositories = defineRepositories({
  live: PrismaEnterpriseGatewayRepositories,
  memory: MemoryEnterpriseGatewayRepositories,
});
