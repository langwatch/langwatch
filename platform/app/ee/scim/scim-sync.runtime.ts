// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Where the directory-sync lifecycle is composed (D08): the guards over the
 * `ScimSyncState` projection reads, and the ledger writer over the pipeline.
 * The SCIM services take a `ScimSyncLifecycle` and never build one, so a test
 * hands in a fake and production gets this.
 *
 * Composed per call rather than at module load, for the reason the grants
 * service is: it holds no state, and a module-scope instance would resolve
 * the event stack before the App exists.
 */
import { ScimSyncGuards } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaScimSyncProjectionRepository } from "~/server/app-layer/identity/repositories/scim-sync-projection.prisma.repository";
import { ScimSyncLedgerWriter } from "~/server/app-layer/identity/scim-sync-ledger";
import { ScimSyncLifecycle } from "./scim-sync.service";

export function scimSyncLifecycle(prisma: PrismaClient): ScimSyncLifecycle {
  return new ScimSyncLifecycle({
    guards: new ScimSyncGuards({
      syncs: new PrismaScimSyncProjectionRepository(prisma),
    }),
    ledger: new ScimSyncLedgerWriter(),
  });
}
