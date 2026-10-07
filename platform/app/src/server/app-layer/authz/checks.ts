/**
 * The checking service, composed once per Prisma handle for permission checks.
 * It is built from the caller's Prisma handle so this helper stays server-only
 * without importing the app-wide database or other process resources.
 */
import { AuthzCollectorService, AuthzService } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { AuthorizationService } from "./authorization.service";
import { demoProjectId } from "./demo-project";
import { authzEpochCacheEnabled, getAuthzEpoch } from "./epoch";
import { GrantsAuthzReadRepository } from "./repositories/authz-read.grants.repository";
import { SharedReadsGrantsRepository } from "./repositories/shared-reads.grants.repository";

const collectorsByPrisma = new WeakMap<PrismaClient, AuthzCollectorService>();
const checksByPrisma = new WeakMap<PrismaClient, AuthzService>();
const doorsByPrisma = new WeakMap<PrismaClient, AuthorizationService>();

function collectorFor(prisma: PrismaClient): AuthzCollectorService {
  const existing = collectorsByPrisma.get(prisma);
  if (existing) return existing;
  const collector = new AuthzCollectorService(
    new GrantsAuthzReadRepository(prisma),
  );
  collectorsByPrisma.set(prisma, collector);
  return collector;
}

export function authzChecksFor(prisma: PrismaClient): AuthzService {
  const existing = checksByPrisma.get(prisma);
  if (existing) return existing;

  const service = new AuthzService(collectorFor(prisma), { demoProjectId });
  checksByPrisma.set(prisma, service);
  return service;
}

/**
 * ADR-144 block B: the door that mints the proof trace reads carry. Built
 * on the same engine the permissions service decides through, so a route's
 * check and its proof can never disagree on the grants.
 */
export function authorizationServiceFor(
  prisma: PrismaClient,
): AuthorizationService {
  const existing = doorsByPrisma.get(prisma);
  if (existing) return existing;

  const service = new AuthorizationService({
    authz: authzChecksFor(prisma),
    collector: collectorFor(prisma),
    sharedReads: new SharedReadsGrantsRepository(prisma),
    epochReader: getAuthzEpoch,
    cacheEnabled: authzEpochCacheEnabled,
  });
  doorsByPrisma.set(prisma, service);
  return service;
}
