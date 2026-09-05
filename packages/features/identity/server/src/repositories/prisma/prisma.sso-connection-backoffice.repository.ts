import type { SsoConnectionState } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  SsoConnectionBackofficePage,
  SsoConnectionBackofficeRepository,
} from "../sso-connection-backoffice.repository";
import { PrismaSsoConnectionProjectionRepository } from "./prisma.sso-connection-projection.repository";

/** The two models the operator back office reads, and no others. */
export type PrismaSsoConnectionBackofficeDatabase = Pick<
  PrismaClient,
  "ssoConnection" | "organization"
>;

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

/** The back office's reads over the `SsoConnection` head and its organizations. */
export class PrismaSsoConnectionBackofficeRepository implements SsoConnectionBackofficeRepository {
  static create(
    database: PrismaSsoConnectionBackofficeDatabase,
  ): PrismaSsoConnectionBackofficeRepository {
    return new PrismaSsoConnectionBackofficeRepository(database);
  }

  private constructor(private readonly prisma: PrismaSsoConnectionBackofficeDatabase) {}

  async findPage({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<SsoConnectionBackofficePage> {
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

    return {
      states: rows.map((row) => PrismaSsoConnectionProjectionRepository.rowToConnection(row)),
      total,
    };
  }

  async findById({ connectionId }: { connectionId: string }): Promise<SsoConnectionState | null> {
    const row = await this.prisma.ssoConnection.findUnique({
      where: { id: connectionId },
    });

    return row === null ? null : PrismaSsoConnectionProjectionRepository.rowToConnection(row);
  }

  async findOrganizationNames({
    organizationIds,
  }: {
    organizationIds: string[];
  }): Promise<Map<string, string>> {
    const unique = [...new Set(organizationIds)];
    if (unique.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.organization.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });

    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
