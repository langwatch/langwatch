import { BILLING_ROLE_KEY } from "@langwatch/authz-contract";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import {
  AuthzBillingGrantRepository,
  type BillingGrantRow,
} from "../authz-billing-grant.repository.ts";
import type { AuthzDatabase } from "../authz-read.repository.ts";
import { liveGrants } from "./eventing.authz-live-rows.mapper.ts";

type BillingGrantDatabase = Pick<AuthzDatabase, "grant" | "organizationUser">;

const billingGrantRowsSchema = z.array(z.object({ id: z.string(), principalId: z.string() }));
const memberRowsSchema = z.array(z.object({ userId: z.string() }));

/** Reads the Billing role off the grants head the ledger projects. */
export class EventingAuthzBillingGrantRepository extends AuthzBillingGrantRepository {
  static create(database: BillingGrantDatabase): EventingAuthzBillingGrantRepository {
    return new EventingAuthzBillingGrantRepository(database);
  }

  private constructor(private readonly database: BillingGrantDatabase) {
    super();
  }

  async findGrants({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId?: string;
  }): Promise<BillingGrantRow[]> {
    const rows = await liveGrants(this.database).findMany({
      where: {
        organizationId,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        principalType: "USER",
        roleKey: BILLING_ROLE_KEY,
        ...(userId !== undefined ? { principalId: userId } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: toDate(nowInstant()) } }],
      },
      select: { id: true, principalId: true },
      orderBy: { occurredAt: "asc" },
    });

    return billingGrantRowsSchema
      .parse(rows)
      .map((row) => ({ grantId: row.id, userId: row.principalId }));
  }

  async findEnabledMemberIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.database.organizationUser.findMany({
      where: { organizationId, userId: { in: [...userIds] }, disabledAt: null },
      select: { userId: true },
    });

    return memberRowsSchema.parse(rows).map((row) => row.userId);
  }
}
