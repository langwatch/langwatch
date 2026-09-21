/**
 * The one place that builds the self-hosted instance registry as the app uses
 * it: Prisma for the rows, the license registry for the customer behind an
 * install (ADR-139, section 10).
 */

import type { PrismaClient } from "~/generated/prisma/client";
import {
  PrismaInstanceOwners,
  PrismaOrganizationNames,
  PrismaSelfHostedInstances,
} from "./selfHostedInstance.prisma";
import { SelfHostedInstanceService } from "./selfHostedInstance.service";

export function createSelfHostedInstanceService(
  prisma: PrismaClient,
): SelfHostedInstanceService {
  return new SelfHostedInstanceService({
    repository: new PrismaSelfHostedInstances(prisma),
    owners: new PrismaInstanceOwners(prisma),
    organizations: new PrismaOrganizationNames(prisma),
  });
}
