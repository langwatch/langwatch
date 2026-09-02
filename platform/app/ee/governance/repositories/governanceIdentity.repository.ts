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

/**
 * The kinds a `DiscoveredPerson.kind` can hold (ADR-128 §10).
 *
 * Machine logins are their own kind and never get matched to an account: filing
 * a service principal's traffic under an employee's name would put plumbing in
 * that employee's spend, and agent-adoption numbers must not count plumbing.
 */
export const DISCOVERED_PERSON_KIND = {
  PERSON: "person",
  SERVICE_ACCOUNT: "service_account",
} as const;

/** Provider-side people seen on cost and audit rows — the unit of erasure. */
export class DiscoveredPersonRepository {
  /** Cross-org-safe: returns the row only when it belongs to the org. */
  findById(client: Client, params: { id: string; organizationId: string }) {
    return client.discoveredPerson.findFirst({
      where: { id: params.id, organizationId: params.organizationId },
    });
  }

  /**
   * The people the match engine is allowed to act on (ADR-128 §12).
   *
   * Three exclusions, all of them load-bearing rather than tidiness:
   *
   *  - **machine logins**, which are not people and must never carry a person's
   *    name;
   *  - **suspended people**, because a halt on automatic linking that the next
   *    pass walks straight past is not a halt — this filter IS the halt;
   *  - **erased people**, whose identifier is a stand-in now. Re-matching one
   *    would attach an account to the very row an erasure just detached one
   *    from, and a digest happens not to parse as an address today, which is a
   *    coincidence rather than a guarantee.
   */
  findMatchable(client: Client, params: { organizationId: string }) {
    return client.discoveredPerson.findMany({
      where: {
        organizationId: params.organizationId,
        kind: DISCOVERED_PERSON_KIND.PERSON,
        suspendedAt: null,
        erasedAt: null,
      },
      orderBy: { id: "asc" },
    });
  }

  /**
   * Stops automatic linking for one person, and says why.
   *
   * Only ever sets a halt that is not already there: `suspendedAt` is the
   * timestamp of the FIRST contradiction, and re-stamping it on every pass
   * would make a reviewer's "how long has this been stuck?" unanswerable.
   */
  async suspend(
    client: Client,
    params: {
      id: string;
      organizationId: string;
      at: Date;
      reason: string;
    },
  ): Promise<number> {
    const result = await client.discoveredPerson.updateMany({
      where: {
        id: params.id,
        organizationId: params.organizationId,
        suspendedAt: null,
      },
      data: { suspendedAt: params.at, suspendedReason: params.reason },
    });
    return result.count;
  }

  /**
   * Declares the daily cost rows unfinished, and records which day a rebuild
   * would have to start from.
   *
   * Written BEFORE the rows are deleted, and that is the whole point of it.
   * Afterwards there is nothing left to ask which days carried the identifier,
   * so a crash between the delete and the rebuild would otherwise leave those
   * days permanently short with no record that anything was owed.
   */
  async markMoneyRowsPending(
    client: Client,
    params: {
      id: string;
      organizationId: string;
      at: Date;
      rebuildSince: string | null;
    },
  ): Promise<number> {
    const result = await client.discoveredPerson.updateMany({
      where: { id: params.id, organizationId: params.organizationId },
      data: {
        moneyRowsPendingAt: params.at,
        moneyRebuildSince: params.rebuildSince,
      },
    });
    return result.count;
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

  /**
   * Records that the daily cost rows are dealt with: removed, and their rebuild
   * asked for.
   *
   * The last write of an erasure, and the only thing that makes a later call a
   * genuine no-op. Until it lands, every call picks the unfinished work back
   * up.
   */
  async settleMoneyRows(
    client: Client,
    params: { id: string; organizationId: string },
  ): Promise<number> {
    const result = await client.discoveredPerson.updateMany({
      where: { id: params.id, organizationId: params.organizationId },
      data: { moneyRowsPendingAt: null, moneyRebuildSince: null },
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
   * Every open link in the organization — the "who is already spoken for" read
   * the match engine makes once per pass.
   *
   * Open means `validTo` is null. A closed link is history and must not stop a
   * new one being opened: that is exactly what makes a re-issued address
   * survivable (ADR-128 §12).
   *
   * Rows whose `userId` an erasure blanked are excluded. They are open links to
   * nobody, and a matcher treating one as "spoken for" would refuse to ever
   * link that provider identity again.
   */
  findOpenByOrganization(client: Client, params: { organizationId: string }) {
    return client.identityMatch.findMany({
      where: {
        organizationId: params.organizationId,
        validTo: null,
        userId: { not: null },
      },
      select: { discoveredPersonId: true, userId: true },
    });
  }

  /**
   * Opens a link, recording what proved it and from when.
   *
   * No upsert and no catch: the exclusion constraint refuses a second link
   * overlapping an open one with SQLSTATE 23P01, and that refusal is the
   * database holding a rule the application would otherwise have to remember.
   * The caller maps it; swallowing it here would let a race quietly re-point
   * somebody's spend.
   */
  open(
    client: Client,
    params: {
      organizationId: string;
      discoveredPersonId: string;
      userId: string;
      evidenceKind: string;
      validFrom: Date;
    },
  ) {
    return client.identityMatch.create({
      data: {
        organizationId: params.organizationId,
        discoveredPersonId: params.discoveredPersonId,
        userId: params.userId,
        evidenceKind: params.evidenceKind,
        validFrom: params.validFrom,
      },
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

/** Candidate matches the background job computed, waiting on a human (§12). */
export class IdentityMatchSuggestionRepository {
  /** One organization's review queue, strongest candidate first. */
  findAllByOrganization(client: Client, params: { organizationId: string }) {
    return client.identityMatchSuggestion.findMany({
      where: { organizationId: params.organizationId },
      orderBy: [{ score: "desc" }, { id: "asc" }],
    });
  }

  /** One candidate pair, or null. Cross-org-safe: the org is in the predicate. */
  findOne(client: Client, params: { id: string; organizationId: string }) {
    return client.identityMatchSuggestion.findFirst({
      where: { id: params.id, organizationId: params.organizationId },
    });
  }

  /**
   * Swaps one organization's whole queue for what the job just computed.
   *
   * Wholesale rather than a diff, and in one transaction. The job derives the
   * queue from scratch every pass, so a row it did not re-derive is a candidate
   * its inputs no longer imply — a person who has since been linked, an account
   * that left the organization, a name that was corrected. Leaving those behind
   * is how a review queue fills with decisions that no longer mean anything.
   *
   * The transaction is what stops a reviewer seeing an empty queue mid-pass and
   * concluding there is nothing to do.
   *
   * `skipDuplicates` covers two passes overlapping: the unique on
   * (organization, person, account) makes the re-derived rows collide rather
   * than double, so the loser of the race contributes nothing instead of
   * failing the whole pass.
   */
  async replaceForOrganization(
    client: PrismaClient,
    params: {
      organizationId: string;
      suggestions: {
        discoveredPersonId: string;
        userId: string;
        score: number;
      }[];
      computedAt: Date;
    },
  ): Promise<{ removed: number; written: number }> {
    return await client.$transaction(async (tx) => {
      const removed = await tx.identityMatchSuggestion.deleteMany({
        where: { organizationId: params.organizationId },
      });
      if (params.suggestions.length === 0) {
        return { removed: removed.count, written: 0 };
      }
      const written = await tx.identityMatchSuggestion.createMany({
        data: params.suggestions.map((suggestion) => ({
          organizationId: params.organizationId,
          discoveredPersonId: suggestion.discoveredPersonId,
          userId: suggestion.userId,
          score: suggestion.score,
          computedAt: params.computedAt,
        })),
        skipDuplicates: true,
      });
      return { removed: removed.count, written: written.count };
    });
  }

  /**
   * Removes every candidate for one person — what confirming one of them means
   * for the rest.
   *
   * All of them, not just the confirmed row: the person now holds a link, so
   * every other candidate for them is a decision nobody will ever make.
   */
  async deleteAllForPerson(
    client: Client,
    params: { organizationId: string; discoveredPersonId: string },
  ): Promise<number> {
    const result = await client.identityMatchSuggestion.deleteMany({
      where: {
        organizationId: params.organizationId,
        discoveredPersonId: params.discoveredPersonId,
      },
    });
    return result.count;
  }
}

/**
 * The accounts a discovered person could turn out to be: this organization's
 * members, indexed the two ways provider evidence arrives.
 *
 * Reads across `OrganizationUser`, `User` and the directory tables, which is
 * why it is its own repository rather than a method on the identity ones — the
 * identity tables are ADR-128's, and these are ADR-101's, and the match engine
 * is the seam between them rather than a reason to merge them.
 */
export class OrganizationAccountDirectoryRepository {
  /**
   * Members whose address they have confirmed, and the address.
   *
   * Confirmed only, deliberately: an unconfirmed address is a string somebody
   * typed into a profile, and this is the evidence a link opens on without
   * anybody looking. Anyone could otherwise claim a colleague's address and
   * collect their spend.
   */
  async findVerifiedMemberEmails(
    client: Client,
    params: { organizationId: string },
  ): Promise<{ userId: string; email: string }[]> {
    const rows = await client.organizationUser.findMany({
      where: {
        organizationId: params.organizationId,
        user: { emailVerified: true },
      },
      select: { userId: true, user: { select: { email: true } } },
    });
    return rows.flatMap((row) =>
      row.user.email ? [{ userId: row.userId, email: row.user.email }] : [],
    );
  }

  /** Members and the display name a suggestion would score against. */
  async findMemberNames(
    client: Client,
    params: { organizationId: string },
  ): Promise<{ userId: string; name: string }[]> {
    const rows = await client.organizationUser.findMany({
      where: { organizationId: params.organizationId },
      select: {
        userId: true,
        user: { select: { name: true, email: true } },
      },
    });
    // The address is the fallback rather than a second candidate: a member with
    // no display name still has a text worth scoring, and scoring both would
    // let one member produce two rows for one discovered person.
    return rows.flatMap((row) => {
      const name = row.user.name ?? row.user.email;
      return name ? [{ userId: row.userId, name }] : [];
    });
  }

  /**
   * The identity provider's own identifiers for this organization's members.
   *
   * Two hops rather than one because `ScimExternalId` is keyed by connection,
   * not by organization: an identifier means something only relative to the
   * directory that issued it, and the same person carries different ones on two
   * connections. An empty connection list short-circuits, so an organization
   * with no directory pays one query rather than a scan.
   */
  async findDirectoryIds(
    client: Client,
    params: { organizationId: string },
  ): Promise<{ userId: string; externalId: string }[]> {
    const connections = await client.ssoConnection.findMany({
      where: { organizationId: params.organizationId },
      select: { id: true },
    });
    if (connections.length === 0) return [];
    return await client.scimExternalId.findMany({
      where: { connectionId: { in: connections.map((row) => row.id) } },
      select: { userId: true, externalId: true },
    });
  }
}
