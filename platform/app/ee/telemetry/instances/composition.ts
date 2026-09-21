/**
 * The one place that builds the self-hosted instance registry as the app uses
 * it: Prisma for the rows, the license registry for the customer behind an
 * install (ADR-139, section 10).
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { tryGetApp } from "~/server/app-layer/app";
import { PrismaCloudCustomers } from "../crm/cloudCustomer.prisma";
import type { SelfHostedCrm } from "../crm/selfHostedCrm";
import { SelfHostedCrmService } from "../crm/selfHostedCrm.service";
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
    crm: createSelfHostedCrm(prisma),
  });
}

/**
 * Where a lead signal goes, when there is anywhere for it to go.
 *
 * Null before the application has finished composing itself. The registry
 * takes that as "raise nothing": the report still lands in the database, and
 * the next one raises what this one would have, because a signal is recorded
 * as raised only once it has been announced.
 */
function createSelfHostedCrm(prisma: PrismaClient): SelfHostedCrm | null {
  const app = tryGetApp();
  if (!app) return null;
  return new SelfHostedCrmService({
    customers: new PrismaCloudCustomers(prisma),
    notifications: app.notifications,
    nurturing: app.nurturing ?? null,
    baseUrl: process.env.BASE_HOST ?? "https://app.langwatch.ai",
  });
}
