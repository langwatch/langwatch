/**
 * ADR-092 — the app's authz composition root: the ONE place Prisma, redis,
 * the EE audit writer and the KSUID minter meet the engine's services.
 * Everything else imports the composed instances from here; nothing else
 * constructs an AuthzService or a grants repository.
 *
 * Only server-only modules may import this file. Its graph reaches
 * `~/server/db`, redis and the EE audit writer at module scope, and loops
 * back into `~/server/api/rbac` via `~/utils/constants` — so a runtime
 * import from rbac.ts (whose enums client code imports) puts Prisma in the
 * browser bundle AND makes rbac.ts's own exports undefined mid-cycle. The
 * shadow service composes per call in `./shadow.ts` for exactly this
 * reason; the reverse-boundary guard in
 * `src/server/__tests__/frontend-boundary.unit.test.ts` walks the graph.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import {
  AuthzCollectorService,
  AuthzService,
  GrantsService,
} from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import type { Prisma } from "@prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "../db";
import { bumpAuthzEpoch, getAuthzEpoch } from "./epoch";
import { PrismaAuthzGrantsRepository } from "./repositories/authz-grants.prisma.repository";
import { PrismaAuthzReadRepository } from "./repositories/authz-read.prisma.repository";

/** COLLECT policies over the Prisma read repository. */
export const authzCollector = new AuthzCollectorService(
  new PrismaAuthzReadRepository(prisma),
);

/** The checking service - can / check / authorize / effectivePermissions. */
export const authz = new AuthzService(authzCollector, {
  epochReader: getAuthzEpoch,
});

/** The grants write surface, composed per call - it holds no state. */
export function grantsService(): GrantsService {
  return new GrantsService(new PrismaAuthzGrantsRepository(prisma), {
    audit: (entry) =>
      auditLog({ ...entry, metadata: entry.metadata as Prisma.JsonObject }),
    newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    bumpEpoch: bumpAuthzEpoch,
  });
}
