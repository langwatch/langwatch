/**
 * ADR-092 — the app's authz composition root: the ONE place Prisma, redis,
 * the EE audit writer and the KSUID minter meet the engine's services.
 * Everything else imports the composed instances from here; nothing else
 * constructs an AuthzService or a grants repository.
 *
 * Only server-only modules may import this file. Its graph reaches
 * `~/server/db`, redis and the EE audit writer at module scope — so a
 * runtime import from rbac.ts (whose enums client code imports) puts Prisma
 * in the browser bundle, where the t3-env client guard throws at module
 * load. The shadow service composes per call in `./shadow.ts` for exactly
 * this reason; the reverse-boundary guard in
 * `src/server/__tests__/frontend-boundary.unit.test.ts` walks the graph.
 *
 * Every environment read the engine's services need is a closure passed from
 * here: the packages read no env of their own.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import {
  AuthzCollectorService,
  AuthzService,
  GrantsService,
} from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import type { Prisma } from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "../db";
import { bumpAuthzEpoch, getAuthzEpoch } from "./epoch";
import { PrismaAuthzGrantsRepository } from "./repositories/authz-grants.prisma.repository";
import { PrismaAuthzReadRepository } from "./repositories/authz-read.prisma.repository";
import { demoProjectId } from "./shadow";

/** COLLECT policies over the Prisma read repository. */
export const authzCollector = new AuthzCollectorService(
  new PrismaAuthzReadRepository(prisma),
);

/**
 * The internal rollout knob for the §12 L1 cache, read per check rather than
 * captured at module load so a test (or a restart-free rollout) can flip it.
 * Unset means off, which is always correct and only slower.
 */
const epochCacheEnabled = (): boolean => {
  const raw = process.env.AUTHZ_EPOCH_CACHE;
  return raw === "1" || raw === "true";
};

/** The checking service - can / check / authorize / effectivePermissions. */
export const authz = new AuthzService(authzCollector, {
  epochReader: getAuthzEpoch,
  cacheEnabled: epochCacheEnabled,
  demoProjectId,
});

/** The grants write surface, composed per call - it holds no state. */
export function grantsService(): GrantsService {
  return new GrantsService(new PrismaAuthzGrantsRepository(prisma), {
    audit: (entry) =>
      auditLog({ ...entry, metadata: entry.metadata as Prisma.JsonObject }),
    newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    bumpEpoch: bumpAuthzEpoch,
    // The offboarding proof re-binds a collector to its own transaction, so
    // the factory is injected rather than the instance above.
    collectorFor: (reader) => new AuthzCollectorService(reader),
  });
}
