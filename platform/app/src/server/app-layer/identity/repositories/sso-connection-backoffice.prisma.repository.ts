import type { SsoConnectionState } from "@langwatch/identity";
import type { PrismaClient } from "~/generated/prisma/client";
import type { SsoConnectionBackofficeReadsPort } from "../sso-connection-backoffice.service";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";

/**
 * The back office's read of the `SsoConnection` projection, and of the
 * organization names it renders beside it (D05 tier 1).
 *
 * A repository of its own rather than a method on
 * `PrismaSsoConnectionReadRepository`, because the questions differ in kind:
 * the guards ask about ONE connection they already name, and the back office
 * asks for a page of connections across every customer, searched by whatever
 * identifier an operator happens to have to hand. A `findMany` with a
 * cross-tenant `where` on the guards' repository would be an invitation to
 * reach for it from a tenant-scoped path.
 *
 * Rows become `SsoConnectionState` here, through the same `rowToConnection`
 * the fold writes them with, so the service above maps one shape rather than
 * knowing the column layout.
 */
export class PrismaSsoConnectionBackofficeRepository
  implements SsoConnectionBackofficeReadsPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async findPage({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{
    connections: readonly SsoConnectionState[];
    total: number;
  }> {
    const where = search ? searchFilter(search) : {};
    const [rows, total] = await Promise.all([
      this.prisma.ssoConnection.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.ssoConnection.count({ where }),
    ]);
    return { connections: rows.map(rowToConnection), total };
  }

  async findById({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoConnectionState | null> {
    const row = await this.prisma.ssoConnection.findUnique({
      where: { id: connectionId },
    });
    return row === null ? null : rowToConnection(row);
  }

  async findOrganizationNames({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(organizationIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.organization.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

/**
 * Search over the identifiers and domains an operator would have to hand: a
 * connection id from a log line, an organization id from a support thread, or
 * the domain the customer told them about.
 */
function searchFilter(search: string) {
  const term = search.trim();
  return {
    OR: [
      { id: { contains: term, mode: "insensitive" as const } },
      { organizationId: { contains: term, mode: "insensitive" as const } },
      { verifiedDomains: { has: term.toLowerCase() } },
      { claimedDomains: { has: term.toLowerCase() } },
      { approvedDomains: { has: term.toLowerCase() } },
    ],
  };
}
