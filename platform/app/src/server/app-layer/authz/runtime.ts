/**
 * ADR-092 — the app's authz composition root: the ONE place Prisma, redis,
 * the EE audit writer and the KSUID minter meet the engine's services.
 * Everything else imports the composed instances from here; nothing else
 * constructs an AuthzService or a grants repository.
 *
 * Only server-only modules may import this file. Its graph reaches the app
 * database and other server dependencies at module scope, so browser-facing
 * permission helpers compose from their caller's Prisma handle instead.
 *
 * Every environment read the engine's services need is a closure passed from
 * here: the packages read no env of their own.
 */
import {
  AuthzCollectorService,
  AuthzService,
  GrantsService,
} from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "../../db";
import { demoProjectId } from "./demo-project";
import { bumpAuthzEpoch, getAuthzEpoch } from "./epoch";
import { grantsLedgerWriter } from "./ledger";
import { LedgerAuthzGrantsRepository } from "./repositories/authz-grants.ledger.repository";
import { GrantsAuthzReadRepository } from "./repositories/authz-read.grants.repository";

/**
 * COLLECT policies over the grants projection. Migration status remains
 * available to the migration runner and compatibility writes, while runtime
 * authorization decisions use one head consistently.
 */
export const authzCollector = new AuthzCollectorService(
  new GrantsAuthzReadRepository(prisma),
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

/**
 * The grants write surface, composed per call - it holds no state. Since
 * delivery-plan PR 2 the repository is ledger-backed: every write is a
 * grants-ledger command, and the audit trail is the pipeline's insert-only
 * subscriber (decision 17), not a writer dependency here.
 */
export function grantsService(): GrantsService {
  return new GrantsService(
    new LedgerAuthzGrantsRepository(prisma, grantsLedgerWriter()),
    {
      newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      bumpEpoch: bumpAuthzEpoch,
      // The offboarding proof re-binds a collector to its own transaction, so
      // the factory is injected rather than the instance above.
      collectorFor: (reader) => new AuthzCollectorService(reader),
    },
  );
}
