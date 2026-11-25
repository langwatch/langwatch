import {
  PLATFORM_OPERATOR_ROLE_ID,
  PLATFORM_TENANT_ID,
  type PlatformOperator,
} from "@langwatch/authz-contract";
import { fromDate, nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import { AuthzPlatformGrantRepository } from "../authz-platform-grant.repository.ts";
import type { AuthzDatabase } from "../authz-read.repository.ts";
import { liveGrants } from "./eventing.authz-live-rows.mapper.ts";

type PlatformGrantDatabase = Pick<AuthzDatabase, "grant">;

const platformGrantRowsSchema = z.array(
  z.object({ id: z.string(), principalId: z.string(), occurredAt: z.date() }),
);

/** Reads the platform tier off the grants head the ledger projects. */
export class EventingAuthzPlatformGrantRepository extends AuthzPlatformGrantRepository {
  static create(database: PlatformGrantDatabase): EventingAuthzPlatformGrantRepository {
    return new EventingAuthzPlatformGrantRepository(database);
  }

  private constructor(private readonly database: PlatformGrantDatabase) {
    super();
  }

  findGrants({
    grantId,
    userId,
  }: {
    grantId?: string;
    userId?: string;
  }): Promise<PlatformOperator[]> {
    return this.findPlatformRows({
      ...(grantId !== undefined ? { id: grantId } : {}),
      ...(userId !== undefined ? { principalId: userId } : {}),
    });
  }

  private async findPlatformRows(narrowing: Record<string, string>): Promise<PlatformOperator[]> {
    const rows = await liveGrants(this.database).findMany({
      where: {
        organizationId: PLATFORM_TENANT_ID,
        scopeType: "PLATFORM",
        scopeId: PLATFORM_TENANT_ID,
        principalType: "USER",
        roleKey: PLATFORM_OPERATOR_ROLE_ID,
        ...narrowing,
        OR: [{ expiresAt: null }, { expiresAt: { gt: toDate(nowInstant()) } }],
      },
      select: { id: true, principalId: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    });

    return platformGrantRowsSchema.parse(rows).map((row) => ({
      grantId: row.id,
      userId: row.principalId,
      grantedAt: fromDate(row.occurredAt),
    }));
  }
}
