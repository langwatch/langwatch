/**
 * ADR-144: the live shared reads one project holds on others - the
 * `project-reader` rows the reconciler wrote - as the minter needs them.
 * Stored facts only; which of them reach a proof is the service's call.
 */
import { PROJECT_READER_ROLE_KEY } from "@langwatch/authz";
import {
  type GrantCondition,
  grantConditionFromDb,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { liveGrants } from "./live-rows";

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
      where: {
        organizationId,
        principalType: "PROJECT",
        principalId: readerProjectId,
        scopeType: "PROJECT",
        roleKey: PROJECT_READER_ROLE_KEY,
      },
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
