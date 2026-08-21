import {
  type AppendLinkInput,
  EMAIL_EXTERNAL_KINDS,
  type EraseIdentifiersInput,
  type EraseIdentifiersResult,
  type IdentityLinkRow,
  type IdentityLinkStorage,
  isEmailKind,
  type LinkSource,
  type LoginRef,
} from "@langwatch/identity-links";

import type { PrismaClient } from "~/generated/prisma/client";

type DbLinkRow = {
  id: string;
  seq: bigint;
  organizationId: string;
  provider: string;
  providerConnectionId: string;
  externalKind: string;
  externalId: string;
  userId: string | null;
  effectiveFrom: Date;
  recordedAt: Date;
  source: string;
  actorUserId: string | null;
  erasedAt: Date | null;
};

const toRow = (row: DbLinkRow): IdentityLinkRow => ({
  ...row,
  source: row.source as LinkSource,
});

/**
 * The Prisma implementation of the add-only link storage (ADR-094 Decisions
 * 3, 6, 11). Mutators are exactly `appendLink` and `eraseIdentifiers` — a
 * test pins that surface. Every query names `organizationId`
 * (ORG_SCOPED_MODELS enforces it); `providerConnectionId` is a plain id with
 * no relation, so ownership is validated here before an insert that CLAIMS a
 * login (see `assertConnectionBelongsToOrganization` for why a close does not
 * pay that toll).
 *
 * Transactions belong to the caller. Construct this with a Prisma client for a
 * standalone call, or with an interactive-transaction client to enlist in one
 * the caller already opened — which is not a convenience but a requirement in
 * two places: offboarding must write its closing rows inside the membership
 * change's own transaction (Decision 4), and erasure blanks link rows, the
 * directory anchor and the agent snapshots as one unit (Decision 9). Nothing
 * here may open a transaction of its own, because a transaction client has no
 * `$transaction` to open.
 *
 * Erasure here covers link rows only. The erasure feature's other steps —
 * blanking the `OrganizationUser` anchor and person references inside
 * `DiscoveredAgent.snapshot`, and deriving the email tokens this method is
 * handed — belong to `IdentityErasureService`, which owns the transaction all
 * of it runs in.
 */
export class PrismaIdentityLinkStorage implements IdentityLinkStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async appendLink(input: AppendLinkInput): Promise<IdentityLinkRow> {
    if (input.userId !== null) {
      await assertConnectionBelongsToOrganization(this.prisma, input);
    }

    const created = await this.prisma.providerIdentityLink.create({
      data: {
        organizationId: input.organizationId,
        provider: input.provider,
        providerConnectionId: input.providerConnectionId,
        externalKind: input.externalKind,
        externalId: input.externalId,
        userId: input.userId,
        effectiveFrom: input.effectiveFrom,
        source: input.source,
        actorUserId: input.actorUserId,
      },
    });
    return toRow(created);
  }

  async eraseIdentifiers(
    input: EraseIdentifiersInput,
  ): Promise<EraseIdentifiersResult> {
    const { organizationId, userId, emailTokenByExternalId } = input;
    const db = this.prisma;

    const emailIds = [...emailTokenByExternalId.keys()];
    const touched = await db.providerIdentityLink.findMany({
      where: {
        organizationId,
        OR: [
          { userId },
          { actorUserId: userId },
          ...(emailIds.length === 0
            ? []
            : [
                {
                  externalKind: { in: [...EMAIL_EXTERNAL_KINDS] },
                  externalId: { in: emailIds },
                },
              ]),
        ],
      },
      select: {
        id: true,
        userId: true,
        actorUserId: true,
        externalKind: true,
        externalId: true,
      },
    });

    for (const row of touched) {
      await db.providerIdentityLink.update({
        where: { id: row.id },
        data: erasedRowData(row, input),
      });
    }

    return { linkRowsTouched: touched.length };
  }

  async listLinksForLogins(
    organizationId: string,
    logins: readonly LoginRef[],
  ): Promise<IdentityLinkRow[]> {
    if (logins.length === 0) return [];
    const rows = await this.prisma.providerIdentityLink.findMany({
      where: {
        organizationId,
        OR: logins.map((login) => ({
          provider: login.provider,
          providerConnectionId: login.providerConnectionId,
          externalKind: login.externalKind,
          externalId: login.externalId,
        })),
      },
    });
    return rows.map(toRow);
  }
}

/**
 * `providerConnectionId` is a plain id with no database relation, so nothing
 * but this stops one organization writing a link against another's connection
 * (Invariants, "Organization isolation").
 *
 * It guards CLAIMING rows only — an append that names a person. A CLOSING row
 * (`userId` null) always appends, even if the connection has since been
 * deleted: offboarding must never be able to fail because of a dangling id, or
 * a person whose membership just ended would keep their links open forever and
 * the money would keep landing on them. A close claims nothing, it withdraws a
 * claim, and it lands in the caller's own organization where it can only ever
 * affect that organization's own report — so there is no isolation to protect
 * here, only an offboarding to protect.
 *
 * A module function rather than a method on purpose: a test pins the class's
 * prototype to exactly the storage interface, so anything that is not part of
 * that contract stays off it.
 */
async function assertConnectionBelongsToOrganization(
  prisma: PrismaClient,
  {
    organizationId,
    providerConnectionId,
  }: { organizationId: string; providerConnectionId: string },
): Promise<void> {
  const connection = await prisma.ingestionSource.findFirst({
    where: { id: providerConnectionId, organizationId },
    select: { id: true },
  });
  if (!connection) {
    throw new Error(
      `Provider connection ${providerConnectionId} does not belong to organization ${organizationId}`,
    );
  }
}

type ErasableRow = Pick<
  DbLinkRow,
  "userId" | "actorUserId" | "externalKind" | "externalId"
>;

function erasedRowData(row: ErasableRow, erasure: EraseIdentifiersInput) {
  const { userId, emailTokenByExternalId, erasedAt } = erasure;
  const erasedExternalId =
    isEmailKind(row.externalKind) && emailTokenByExternalId.has(row.externalId)
      ? emailTokenByExternalId.get(row.externalId)!
      : row.externalId;

  // `erasedAt` marks a row whose OWN SUBJECT was forgotten — its `userId`
  // blanked, or its email-shaped login id swapped for a token. A row touched
  // only to blank `actorUserId` is still blanked, but carries no stamp.
  //
  // That distinction is not pedantry, it is the difference between a correct
  // report and a wrong one. `resolveOwnerAt` reads `userId === null` plus a
  // stamp as "erased-person", which the report shows as "former member
  // (erased)" inside the ATTRIBUTED bucket. An unlink row that the erased
  // person happened to author already has `userId === null`; stamping it would
  // flip somebody else's login from unattributed to attributed and move money
  // in a period that may already have been reported — to a person who was
  // never there.
  const subjectErased =
    row.userId === userId || erasedExternalId !== row.externalId;

  return {
    userId: row.userId === userId ? null : row.userId,
    actorUserId: row.actorUserId === userId ? null : row.actorUserId,
    externalId: erasedExternalId,
    ...(subjectErased ? { erasedAt } : {}),
  };
}
