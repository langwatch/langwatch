// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EnterpriseGatewayRepositories } from "../routing-policy.repository.ts";
import {
  PrismaRoutingPolicyRepository,
  type RoutingPolicyDatabase,
} from "./prisma.routing-policy.repository.ts";

/** The Enterprise gateway's rows, in Postgres. */
export class PrismaEnterpriseGatewayRepositories {
  static readonly requires = ["prisma"] as const;

  static create({
    prisma,
  }: Readonly<{ prisma: RoutingPolicyDatabase }>): EnterpriseGatewayRepositories {
    return { routingPolicies: PrismaRoutingPolicyRepository.create(prisma) };
  }
}
