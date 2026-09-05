import type { BreakGlassBinding } from "@langwatch/identity";
import type { SsoBreakGlassRepository } from "@langwatch/identity-server";
import type {
  PrismaClient,
  SsoBreakGlassBinding as SsoBreakGlassBindingRow,
} from "~/generated/prisma/client";

/**
 * The ways back in, in Postgres (D05).
 *
 * Append-mostly: a grant and a renewal both INSERT, and the only updates are
 * the two fields that are not the grant itself — `supersededAt`, written once
 * by the renewal that replaced a row, and `warnedDays`, which records what
 * has already been said. That is what keeps "the date it previously ended is
 * still readable in the history" true after somebody renewed.
 */
export class PrismaSsoBreakGlassRepository implements SsoBreakGlassRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]> {
    const rows = await this.prisma.ssoBreakGlassBinding.findMany({
      where: { organizationId },
      orderBy: { grantedAt: "asc" },
    });
    return rows.map(rowToBinding);
  }

  async findById({
    bindingId,
  }: {
    bindingId: string;
  }): Promise<BreakGlassBinding | null> {
    const row = await this.prisma.ssoBreakGlassBinding.findUnique({
      where: { id: bindingId },
    });
    return row === null ? null : rowToBinding(row);
  }

  async create({ binding }: { binding: BreakGlassBinding }): Promise<void> {
    await this.prisma.ssoBreakGlassBinding.create({
      data: {
        id: binding.bindingId,
        organizationId: binding.organizationId,
        userId: binding.userId,
        grantedByUserId: binding.grantedByUserId,
        grantedAt: new Date(binding.grantedAtMs),
        expiresAt: new Date(binding.expiresAtMs),
        supersededAt:
          binding.supersededAtMs === null
            ? null
            : new Date(binding.supersededAtMs),
        renewedFromId: binding.renewedFromBindingId,
        warnedDays: binding.warnedDays,
      },
    });
  }

  async markSuperseded({
    bindingId,
    supersededAtMs,
  }: {
    bindingId: string;
    supersededAtMs: number;
  }): Promise<void> {
    // `updateMany` rather than `update`, so a renewal racing another
    // renewal's write lands as "nothing to supersede" instead of a raw
    // P2025 the reader cannot act on.
    await this.prisma.ssoBreakGlassBinding.updateMany({
      where: { id: bindingId, supersededAt: null },
      data: { supersededAt: new Date(supersededAtMs) },
    });
  }

  async recordWarningsSent({
    bindingId,
    days,
  }: {
    bindingId: string;
    days: number[];
  }): Promise<void> {
    await this.prisma.ssoBreakGlassBinding.updateMany({
      where: { id: bindingId },
      data: { warnedDays: { push: days } },
    });
  }

  /**
   * The sweep's read, and the one on this port that crosses organizations:
   * warnings serve the whole installation, so a query scoped to one customer
   * would leave every other customer's warnings unsent.
   *
   * `expiresAt > now` is what keeps an expired binding out of it. Expiry
   * needs nobody, so a binding that ended while the worker was down is
   * simply over rather than owed a warning about a date that has passed.
   */
  async findLiveExpiringBefore({
    beforeMs,
    nowMs,
    limit,
  }: {
    beforeMs: number;
    nowMs: number;
    limit: number;
  }): Promise<BreakGlassBinding[]> {
    const rows = await this.prisma.ssoBreakGlassBinding.findMany({
      where: {
        supersededAt: null,
        expiresAt: { gt: new Date(nowMs), lte: new Date(beforeMs) },
      },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });
    return rows.map(rowToBinding);
  }
}

function rowToBinding(row: SsoBreakGlassBindingRow): BreakGlassBinding {
  return {
    bindingId: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    grantedByUserId: row.grantedByUserId,
    grantedAtMs: row.grantedAt.getTime(),
    expiresAtMs: row.expiresAt.getTime(),
    supersededAtMs: row.supersededAt?.getTime() ?? null,
    renewedFromBindingId: row.renewedFromId,
    warnedDays: row.warnedDays,
  };
}
