/**
 * The permissions composition root: the one place the client meets the
 * repositories meets the service. Called by the App presets — every runtime
 * consumer resolves the composed instance via `getApp().permissions` rather
 * than composing its own.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { authzChecksFor } from "../authz/checks";
import { EngineCredentialDecisionRepository } from "./credential-decision.repository";
import { EnginePermissionDecisionRepository } from "./permission-decision.repository";
import { PermissionsService } from "./permissions.service";

export function permissionsServiceFor(
  prisma: PrismaClient,
): PermissionsService {
  return new PermissionsService({
    decisions: EnginePermissionDecisionRepository.create(
      authzChecksFor(prisma),
    ),
    credentials: new EngineCredentialDecisionRepository(prisma),
  });
}
