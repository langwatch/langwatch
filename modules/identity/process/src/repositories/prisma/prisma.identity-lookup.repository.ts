import type { LookupOperatorActivityRow } from "@langwatch/identity-contract";
import { IDENTITY_LOOKUP_AUDIT_PREFIX } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type IdentityLookupRepository,
  type LookupConnectionRow,
  type LookupIdentifierRow,
  type LookupInvitationRow,
  type LookupMembershipRow,
  type LookupUserRow,
} from "../identity-lookup.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "./prisma.sso-connection-projection.repository.ts";

/** How many rows a single-address lookup reads before it stops. */
const MATCH_CEILING = 50;

/** The models this surface reads, and no others. */
export type PrismaIdentityLookupDatabase = Pick<
  PrismaClient,
  | "identifier"
  | "user"
  | "organizationUser"
  | "organizationInvite"
  | "ssoConnection"
  | "organization"
  | "auditLog"
>;

export class PrismaIdentityLookupRepository implements IdentityLookupRepository {
  static create(database: PrismaIdentityLookupDatabase): PrismaIdentityLookupRepository {
    return new PrismaIdentityLookupRepository(database);
  }

  private constructor(private readonly prisma: PrismaIdentityLookupDatabase) {}

  async findIdentifiersByValue({
    value,
  }: {
    value: string;
  }): Promise<readonly LookupIdentifierRow[]> {
    const rows = await this.prisma.identifier.findMany({
      where: { value },
      orderBy: { attachedAt: "desc" },
      take: MATCH_CEILING,
    });
    return rows.map(toIdentifierRow);
  }

  async findIdentifiersForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LookupIdentifierRow[]> {
    const rows = await this.prisma.identifier.findMany({
      where: { userId },
      orderBy: { attachedAt: "desc" },
    });
    return rows.map(toIdentifierRow);
  }

  async findUsers({ userIds }: { userIds: readonly string[] }): Promise<readonly LookupUserRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, email: true },
    });
    return rows.map((row) => ({ userId: row.id, name: row.name, email: row.email }));
  }

  async findMemberships({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<readonly LookupMembershipRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.organizationUser.findMany({
      where: { userId: { in: [...userIds] } },
      select: {
        userId: true,
        organizationId: true,
        role: true,
        organization: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      userId: row.userId,
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      role: row.role,
    }));
  }

  async findInvitations({ email }: { email: string }): Promise<readonly LookupInvitationRow[]> {
    const rows = await this.prisma.organizationInvite.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        organizationId: true,
        status: true,
        expiration: true,
        organization: { select: { name: true } },
        requestedByUser: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      inviteId: row.id,
      email: row.email,
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      invitedByName: row.requestedByUser?.name ?? null,
      status: row.status,
      expiresAtMs: row.expiration?.getTime() ?? null,
    }));
  }

  async findConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<LookupConnectionRow | null> {
    const row = await this.prisma.ssoConnection.findFirst({
      where: { verifiedDomains: { has: domain } },
    });
    if (!row) return null;
    const state = PrismaSsoConnectionProjectionRepository.rowToConnection(row);
    const organization = await this.prisma.organization.findUnique({
      where: { id: state.organizationId },
      select: { name: true },
    });
    return {
      connectionId: state.connectionId,
      organizationId: state.organizationId,
      organizationName: organization?.name ?? null,
      state: state.state,
      providerId: state.idpMetadata.providerId,
    };
  }

  async findRecentOperatorActivity({
    limit,
  }: {
    limit: number;
  }): Promise<readonly LookupOperatorActivityRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { startsWith: IDENTITY_LOOKUP_AUDIT_PREFIX } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, userId: true, action: true, args: true, createdAt: true },
    });
    const operatorIds = rows.flatMap((row) => (row.userId ? [row.userId] : []));
    const operators = await this.findUsers({ userIds: operatorIds });
    const named = new Map(operators.map((operator) => [operator.userId, operator.name]));
    return rows.map((row) => ({
      auditId: row.id,
      operatorUserId: row.userId,
      operatorName: row.userId ? (named.get(row.userId) ?? null) : null,
      act: row.action.slice(IDENTITY_LOOKUP_AUDIT_PREFIX.length),
      address: findAddress(row.args),
      atMs: row.createdAt.getTime(),
    }));
  }
}

/** The address off an audit row's arguments, when it carried one. */
function findAddress(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const address = (args as { address?: unknown }).address;
  return typeof address === "string" && address.length > 0 ? address : null;
}

interface IdentifierRowShape {
  id: string;
  userId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  state: string;
  connectionId: string | null;
  verifiedAt: Date | null;
  attachedAt: Date;
  detachedAt: Date | null;
}

function toIdentifierRow(row: IdentifierRowShape): LookupIdentifierRow {
  return {
    identifierId: row.id,
    userId: row.userId,
    provider: row.provider,
    value: row.value,
    domain: row.domain,
    state: row.state,
    connectionId: row.connectionId,
    verifiedAtMs: row.verifiedAt?.getTime() ?? null,
    attachedAtMs: row.attachedAt.getTime(),
    detachedAtMs: row.detachedAt?.getTime() ?? null,
  };
}
