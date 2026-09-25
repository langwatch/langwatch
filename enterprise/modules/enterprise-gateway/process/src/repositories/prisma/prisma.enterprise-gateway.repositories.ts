// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ProcessMembers } from "@langwatch/process-stores/members";

import type { EnterpriseGatewayRepositories } from "../routing-policy.repository.ts";
import { PrismaRoutingPolicyRepository } from "./prisma.routing-policy.repository.ts";

/** The Enterprise gateway's rows, in Postgres. */
export class PrismaEnterpriseGatewayRepositories {
  static readonly requires = ["prisma"] as const;

  static create({ prisma }: Pick<ProcessMembers, "prisma">): EnterpriseGatewayRepositories {
    return { routingPolicies: PrismaRoutingPolicyRepository.create(prisma) };
  }
}
