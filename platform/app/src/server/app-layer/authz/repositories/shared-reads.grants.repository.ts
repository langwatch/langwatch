/**
 * ADR-144: the live shared reads one project holds on others - the
 * `project-reader` rows the reconciler wrote - as the minter needs them.
 * Stored facts only; which of them reach a proof is the service's call.
 */

import type { GrantCondition } from "@langwatch/actor";
import {
  PROJECT_READER_ROLE_KEY,
  STORED_PRINCIPAL_KIND,
} from "@langwatch/authz";
import { grantConditionFromDb } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { liveGrants } from "./live-rows";

/**
 * The rows that are one reader project's shared reads (ADR-144), spelled
 * once: the minter's read here, and the ledger's list, revoke and attach
 * identity. Lives in this light module rather than the ledger, so the door
 * reads it without pulling the ledger's database client onto its graph.
 */
export function sharedProjectReadsOf({
  organizationId,
  readerProjectId,
}: {
  organizationId: string;
  readerProjectId: string;
}) {
  return {
    organizationId,
    principalType: STORED_PRINCIPAL_KIND.project,
    principalId: readerProjectId,
    scopeType: "PROJECT" as const,
    roleKey: PROJECT_READER_ROLE_KEY,
  };
}

export type SharedReadRow = {
  grantId: string;
  memberProjectId: string;
  condition: GrantCondition;
  expiresAt: Date | null;
};

export class SharedReadsGrantsRepository {
  constructor(private readonly prisma: Pick<PrismaClient, "grant">) {}

  /**
   * A row whose stored condition does not parse is left out rather than
   * read as unconditioned: a window the proof cannot state is a window the
   * proof must not open.
   */
  async findLiveSharedReads({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<SharedReadRow[]> {
    const rows = await liveGrants(this.prisma).findMany({
      where: sharedProjectReadsOf({ organizationId, readerProjectId }),
      select: { id: true, scopeId: true, condition: true, expiresAt: true },
    });
    return rows.flatMap((row) => {
      const condition = grantConditionFromDb(row.condition);
      if (!condition) return [];
      return [
        {
          grantId: row.id,
          memberProjectId: row.scopeId,
          condition,
          expiresAt: row.expiresAt,
        },
      ];
    });
  }
}
