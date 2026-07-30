import type {
  DueProcessInstance,
  ProcessInstanceKey,
  ProcessStore,
  StoredProcessState,
} from "@langwatch/event-sourcing";
import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";

/** deriveStateVersion (packages/event-sourcing) never produces an empty
 * string, so this can never collide with a real stamp. */
export const LEGACY_STATE_VERSION = "";

export class RevisionConflictError extends Error {
  constructor(readonly key: ProcessInstanceKey) {
    super(
      `process instance revision conflict for ${key.processName}/${key.projectId}/${key.processKey}`,
    );
    this.name = "RevisionConflictError";
  }
}

function compoundKey(key: ProcessInstanceKey) {
  return {
    processName: key.processName,
    projectId: key.projectId,
    processKey: key.processKey,
  };
}

export function prismaProcessStore(prisma: PrismaClient): ProcessStore {
  return {
    async load(key): Promise<StoredProcessState | null> {
      const row = await prisma.processManagerInstance.findUnique({
        where: {
          projectId: key.projectId,
          processName_projectId_processKey: compoundKey(key),
        },
      });
      if (!row) return null;
      return {
        state: row.state,
        revision: row.revision,
        stateVersion: row.stateVersion ?? LEGACY_STATE_VERSION,
        tenantId: row.tenantId,
      };
    },

    async save({
      key,
      tenantId,
      state,
      stateVersion,
      expectedRevision,
      nextWakeAt,
    }): Promise<void> {
      const now = new Date();
      const nextWakeAtDate = nextWakeAt === null ? null : new Date(nextWakeAt);

      if (expectedRevision === 0) {
        const inserted = await prisma.processManagerInstance.createMany({
          data: [
            {
              id: generate(KSUID_RESOURCES.PROCESS_MANAGER_INSTANCE).toString(),
              ...compoundKey(key),
              tenantId,
              state: state as Prisma.InputJsonValue,
              revision: 1,
              stateVersion,
              nextWakeAt: nextWakeAtDate,
              updatedAt: now,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count !== 1) throw new RevisionConflictError(key);
        return;
      }

      // `updateMany` is not usable here: under relationMode = "prisma" it
      // compiles to SELECT-matching-ids-then-UPDATE-those-ids, so the
      // revision predicate is only checked by the SELECT — two concurrent
      // callers can both pass it before either commits, and both updates
      // then apply unconditionally by id. A single hand-written UPDATE
      // is the only statement Postgres itself evaluates atomically against
      // the row's current revision.
      const updated = await prisma.$executeRaw`
        UPDATE "ProcessManagerInstance"
        SET "tenantId" = ${tenantId},
            "state" = ${JSON.stringify(state)}::jsonb,
            "revision" = ${expectedRevision + 1},
            "stateVersion" = ${stateVersion},
            "nextWakeAt" = ${nextWakeAtDate},
            "updatedAt" = ${now}
        WHERE "processName" = ${key.processName}
          AND "projectId" = ${key.projectId}
          AND "processKey" = ${key.processKey}
          AND "revision" = ${expectedRevision}
      `;
      if (updated !== 1) throw new RevisionConflictError(key);
    },

    async due(now, limit): Promise<readonly DueProcessInstance[]> {
      // @tenancy: cross-tenant wake poll — bounded by the nextWakeAt deadline,
      // not by any single project (ADR-108 decision 11).
      const rows = await prisma.$queryRaw<
        {
          processName: string;
          projectId: string;
          processKey: string;
          tenantId: string;
          nextWakeAt: Date;
        }[]
      >`
        SELECT "processName", "projectId", "processKey", "tenantId", "nextWakeAt"
        FROM "ProcessManagerInstance"
        WHERE "nextWakeAt" IS NOT NULL AND "nextWakeAt" <= ${new Date(now)}
        ORDER BY "nextWakeAt" ASC
        LIMIT ${limit}
      `;
      return rows.map((row) => ({
        processName: row.processName,
        projectId: row.projectId,
        processKey: row.processKey,
        tenantId: row.tenantId,
        nextWakeAt: row.nextWakeAt.getTime(),
      }));
    },
  };
}
