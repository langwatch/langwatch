/**
 * The checking service, composed once per Prisma handle for permission checks.
 * It is built from the caller's Prisma handle so this helper stays server-only
 * without importing the app-wide database or other process resources.
 */
import { AuthzCollectorService, AuthzService } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { demoProjectId } from "./demo-project";
import { GrantsAuthzReadRepository } from "./repositories/authz-read.grants.repository";

const checksByPrisma = new WeakMap<PrismaClient, AuthzService>();

export function authzChecksFor(prisma: PrismaClient): AuthzService {
  const existing = checksByPrisma.get(prisma);
  if (existing) return existing;

  const service = new AuthzService(
    new AuthzCollectorService(new GrantsAuthzReadRepository(prisma)),
    { demoProjectId },
  );
  checksByPrisma.set(prisma, service);
  return service;
}
