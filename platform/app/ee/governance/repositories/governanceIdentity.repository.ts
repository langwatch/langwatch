// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Row access for the governance identity tables (ADR-128 §11). Every
 * `prisma.discoveredPerson.*`, `prisma.identityMatch.*`,
 * `prisma.governanceTenantHistory.*` and
 * `prisma.erasedIdentifierSuppression.*` call lives here; services own the
 * orchestration and the guards.
 *
 * Everything is scoped by `organizationId` rather than by the hidden
 * governance project, because that project's id can be archived out from under
 * a row while the write path keeps using it (see `GovernanceTenantHistory`).
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import type { Prisma, PrismaClient } from "~/generated/prisma/client";

type Client = Prisma.TransactionClient | PrismaClient;

/** Every `TenantId` an organization has ever written governance rows under. */
export class GovernanceTenantHistoryRepository {
  /**
   * The organization's whole tenant history, oldest first. Reads resolve
   * against all of it for totals, and erasure walks all of it — personal data
   * does not stop existing in a tenant that stopped being current.
   */
  findAllByOrganization(client: Client, params: { organizationId: string }) {
    return client.governanceTenantHistory.findMany({
      where: { organizationId: params.organizationId },
      orderBy: { firstUsedAt: "asc" },
    });
  }

  /** The organization that owns a tenant, or null when it was never recorded. */
  findByTenantId(client: Client, params: { tenantId: string }) {
    return client.governanceTenantHistory.findFirst({
      where: { tenantId: params.tenantId },
    });
  }

  /**
   * Moves `lastUsedAt` forward on an already-recorded tenant, and reports
   * whether there was one. A miss is the caller's signal to append.
   */
  async touch(
    client: Client,
    params: { organizationId: string; tenantId: string; at: Date },
  ): Promise<boolean> {
    const result = await client.governanceTenantHistory.updateMany({
      where: {
        organizationId: params.organizationId,
        tenantId: params.tenantId,
      },
      data: { lastUsedAt: params.at },
    });
    return result.count > 0;
  }

  /**
   * Records a tenant the first time it is used. `skipDuplicates` rather than a
   * caught P2002: two workers resolving the same governance project in the same
   * instant is the normal case, not an exception.
   */
  async append(
    client: Client,
    params: { organizationId: string; tenantId: string; at: Date },
  ): Promise<void> {
    await client.governanceTenantHistory.createMany({
      data: [
        {
          organizationId: params.organizationId,
          tenantId: params.tenantId,
          firstUsedAt: params.at,
          lastUsedAt: params.at,
        },
      ],
      skipDuplicates: true,
    });
  }

  /** Every recorded (organization, tenant) pair — the snapshot loader's read. */
  findAll(client: Client) {
    return client.governanceTenantHistory.findMany({
      select: { organizationId: true, tenantId: true },
    });
  }
}

/** The do-not-reimport list: hashes of erased identifiers (ADR-128 §9 step 1). */
export class ErasedIdentifierSuppressionRepository {
  /** One organization's whole list — small, and read as a set by write paths. */
  findAllByOrganization(client: Client, params: { organizationId: string }) {
    return client.erasedIdentifierSuppression.findMany({
      where: { organizationId: params.organizationId },
    });
  }

  /** Every suppression row across every organization, for the shared snapshot. */
  findAll(client: Client) {
    return client.erasedIdentifierSuppression.findMany({
      select: { organizationId: true, provider: true, identifierHash: true },
    });
  }

  /**
   * Records digests as suppressed. Idempotent: erasing the same person twice,
   * or two people who share an identifier at one provider, must not fail.
   */
  async recordAll(
    client: Client,
    params: {
      organizationId: string;
      provider: string;
      identifierHashes: string[];
      erasedAt: Date;
    },
  ): Promise<number> {
    if (params.identifierHashes.length === 0) return 0;
    const result = await client.erasedIdentifierSuppression.createMany({
      data: params.identifierHashes.map((identifierHash) => ({
        organizationId: params.organizationId,
        provider: params.provider,
        identifierHash,
        erasedAt: params.erasedAt,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }
}

/** Provider-side people seen on cost and audit rows — the unit of erasure. */
export class DiscoveredPersonRepository {
  /** Cross-org-safe: returns the row only when it belongs to the org. */
  findById(client: Client, params: { id: string; organizationId: string }) {
    return client.discoveredPerson.findFirst({
      where: { id: params.id, organizationId: params.organizationId },
    });
  }

  /**
   * Replaces the identifier and the display text with the pseudonym, in place.
   *
   * The row itself survives on purpose (ADR-128 §9 step 3): its spend is still
   * somebody's, and deleting the row would move that money to "unknown" rather
   * than to "a person we are no longer allowed to name". `erasedAt` is what
   * tells a later reader which of those two it is looking at.
   */
  async pseudonymize(
    client: Client,
    params: {
      id: string;
      organizationId: string;
      pseudonym: string;
      erasedAt: Date;
    },
  ): Promise<number> {
    const result = await client.discoveredPerson.updateMany({
      where: { id: params.id, organizationId: params.organizationId },
      data: {
        rawActorId: params.pseudonym,
        displayText: params.pseudonym,
        erasedAt: params.erasedAt,
      },
    });
    return result.count;
  }
}

/** The dated links between provider-side people and platform users. */
export class IdentityMatchRepository {
  findAllByDiscoveredPerson(
    client: Client,
    params: { organizationId: string; discoveredPersonId: string },
  ) {
    return client.identityMatch.findMany({
      where: {
        organizationId: params.organizationId,
        discoveredPersonId: params.discoveredPersonId,
      },
      orderBy: { validFrom: "asc" },
    });
  }

  /**
   * Blanks the platform-user reference on every link this person holds
   * (ADR-128 §9 step 2), open and closed alike.
   *
   * The rows and their dates stay. Closing or deleting them would rewrite the
   * history of the link, and the erasure's job is to remove the identifier, not
   * to make the past claim the link never existed.
   */
  async blankUserReferences(
    client: Client,
    params: { organizationId: string; discoveredPersonId: string },
  ): Promise<number> {
    const result = await client.identityMatch.updateMany({
      where: {
        organizationId: params.organizationId,
        discoveredPersonId: params.discoveredPersonId,
        userId: { not: null },
      },
      data: { userId: null },
    });
    return result.count;
  }
}
