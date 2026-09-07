/**
 * The three reads behind "why is this person here" (D05 / D08 / D12).
 *
 * Every one of them is BUILT FROM the organization asked about rather than
 * filtered by it afterwards, and every one is additionally bounded by the
 * finite list of people the caller can already see. A bug in this file
 * therefore cannot widen past the members of one organization: there is no
 * query here that could name a person outside the list it was handed.
 *
 * All three are reads of facts written for other reasons — the directory's
 * own identifier mapping, the join-request projection, and the invitation
 * table — so nothing new is recorded to answer the question.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import type {
  DirectoryProvisionedMember,
  DomainAdmittedMember,
  MemberProvenancePort,
} from "../member-provenance.service";

/** Join-request states that actually put somebody in the organization. */
const ADMITTED_STATE = "APPROVED";

/**
 * The resolver a domain policy admission carries, as the projection writes
 * it. An approval an administrator clicked carries their user id instead, so
 * this exact string is what tells the two apart.
 */
const AUTOMATIC_RESOLVER = "domain-auto";

export class PrismaMemberProvenanceRepository implements MemberProvenancePort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * People an identity provider created, via a connection of THIS
   * organization.
   *
   * Two steps rather than one join: the directory's identifier mapping
   * carries no organization (a connection is the only thing that scopes it),
   * so the organization's connections are resolved first and the mapping is
   * read against those. A person mapped on somebody else's connection is
   * therefore unreachable from here by construction.
   */
  async directoryProvisioned({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<DirectoryProvisionedMember[]> {
    const connections = await this.prisma.ssoConnection.findMany({
      where: { organizationId },
      select: { id: true, idpMetadata: true },
    });
    if (connections.length === 0) return [];

    const providerById = new Map(
      connections.map((connection) => [
        connection.id,
        providerIdOf(connection.idpMetadata),
      ]),
    );

    const rows = await this.prisma.scimExternalId.findMany({
      where: {
        connectionId: { in: [...providerById.keys()] },
        userId: { in: [...userIds] },
      },
      select: { userId: true, connectionId: true },
    });

    return rows.map((row) => ({
      userId: row.userId,
      providerId: providerById.get(row.connectionId) ?? null,
    }));
  }

  /**
   * People a matching domain admitted, and whether anybody approved it.
   *
   * Read off the join-request projection, which records both endings the
   * same way and differs only in who resolved it — which is exactly the
   * distinction the screen has to draw.
   */
  async domainAdmitted({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<DomainAdmittedMember[]> {
    const rows = await this.prisma.joinRequest.findMany({
      where: {
        organizationId,
        userId: { in: [...userIds] },
        state: ADMITTED_STATE,
      },
      select: { userId: true, domain: true, resolvedById: true },
    });

    return rows.map((row) => ({
      userId: row.userId,
      domain: row.domain,
      automatic: row.resolvedById === AUTOMATIC_RESOLVER,
    }));
  }

  /**
   * People who arrived on an invitation somebody here sent.
   *
   * Matched on `acceptedByUserId`, the column the acceptance writes, rather
   * than on the address: an address can be changed afterwards and an
   * invitation matched on one would then name the wrong person.
   */
  async invitedUserIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]> {
    const rows = await this.prisma.organizationInvite.findMany({
      where: {
        organizationId,
        acceptedByUserId: { in: [...userIds] },
      },
      select: { acceptedByUserId: true },
    });

    return rows
      .map((row) => row.acceptedByUserId)
      .filter((userId): userId is string => userId !== null);
  }
}

/**
 * What to call the identity provider on a chip.
 *
 * The projection keeps the provider's own name inside its metadata blob, and
 * a chip that said nothing when the blob is shaped unexpectedly is better
 * than one that says `[object Object]`.
 */
function providerIdOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const providerId = (metadata as { providerId?: unknown }).providerId;
  return typeof providerId === "string" && providerId.length > 0
    ? providerId
    : null;
}
