/**
 * Where the two reconciliation surfaces are composed (ADR-122).
 *
 * A file of its own rather than more lines in `runtime.ts`, for the reason
 * `identity-lookup-runtime.ts` is one: these services hold no state, they are
 * built per call, and the ledger inside the operator one resolves its
 * pipeline handle lazily off the App — so composing at module scope would
 * bind it before an App exists.
 *
 * Server-only. Its graph reaches `~/server/db`.
 */
import { ScimDeprovisionService } from "@ee/scim/scim-deprovision.service";
import { scimSyncLifecycle } from "@ee/scim/scim-sync.runtime";
import type { ScimSyncLifecycle } from "@ee/scim/scim-sync.service";
import { prisma } from "../../db";
import { grantsService } from "../authz/runtime";
import { PrismaScimReconciliationRepository } from "./repositories/scim-reconciliation.prisma.repository";
import {
  ScimOversightService,
  type ScimRedriveApplyPort,
} from "./scim-oversight.service";
import { ScimReconciliationService } from "./scim-reconciliation.service";

function reads(): PrismaScimReconciliationRepository {
  return new PrismaScimReconciliationRepository(prisma);
}

function lifecycle(): ScimSyncLifecycle {
  return scimSyncLifecycle(prisma);
}

/**
 * The re-drive's apply arm: the same deprovision service the SCIM request
 * path uses, so a re-driven removal runs the identical proof a directory's
 * own removal does. A second implementation "for operators" would be a
 * second set of postconditions.
 */
function deprovision(): ScimRedriveApplyPort {
  return new ScimDeprovisionService({
    grants: grantsService(),
    syncLifecycle: lifecycle(),
  });
}

/** The organization's own read of its directory sync. */
export function scimReconciliation(): ScimReconciliationService {
  return new ScimReconciliationService({ reads: reads() });
}

/** The cross-customer operator surface, and its one guarded write. */
export function scimOversight(): ScimOversightService {
  return new ScimOversightService({
    reads: reads(),
    lifecycle,
    deprovision,
  });
}
