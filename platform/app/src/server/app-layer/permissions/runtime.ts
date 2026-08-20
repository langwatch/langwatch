/**
 * The permissions composition root: the one place the client meets the
 * repository meets the service. Unlike `../authz/runtime.ts` it is
 * parameterized on the client rather than importing the singleton, because
 * every boundary passes its own request context's prisma — which is exactly
 * what lets a test inject a fake all the way down.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { ForkAwarePermissionDecisionRepository } from "./permission-decision.repository";
import { PermissionsService } from "./permissions.service";

export function permissionsServiceFor(
  prisma: PrismaClient,
): PermissionsService {
  return new PermissionsService(
    new ForkAwarePermissionDecisionRepository(prisma),
  );
}
