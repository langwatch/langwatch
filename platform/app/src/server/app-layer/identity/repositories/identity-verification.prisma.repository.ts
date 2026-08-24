import type {
  IdentityVerificationRecord,
  IdentityVerificationRepository,
} from "@langwatch/identity-server";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The verification ceremony's row-truth storage (D01): ceremony records live
 * on the better-auth `VerificationToken` protocol table — the same table the
 * adapter's routing table classifies as protocol — never as events. The
 * legacy table has exactly three business columns, so the structured payload
 * rides as JSON in the `token` column the way better-auth itself stores
 * state blobs, and the `identifier` column is the namespaced lookup key.
 *
 * One key per IDENTIFIER (not per verification): minting replaces any prior
 * record for the same identifier, which is what makes "invalidated by any
 * newer mint" a delete-then-insert rather than bookkeeping. The token column
 * carries the HASH of the emailed token — the raw token exists only in the
 * magic link.
 *
 * `identifier` carries no unique constraint (it is better-auth's legacy table,
 * and the key it IS unique on is the whole `(identifier, token)` pair), so
 * "replaces" is a convention this module keeps rather than one the database
 * enforces: two mints racing each other both find nothing to replace and both
 * insert. Reads take the newest, and CONSUMPTION reaps every generation it
 * read — otherwise the older row becomes selectable again the moment the newer
 * one is consumed, and a link a newer mint was supposed to invalidate still
 * completes.
 */

const IDENTITY_VERIFY_KEY_PREFIX = "identity-verify:";

function keyFor(identifierId: string): string {
  return `${IDENTITY_VERIFY_KEY_PREFIX}${identifierId}`;
}

const storedPayloadSchema = z.object({
  v: z.literal(1),
  verificationId: z.string().min(1),
  userId: z.string().min(1),
  identifierId: z.string().min(1),
  tokenHash: z.string().min(1),
  codeChallenge: z.string().min(1),
});
type StoredPayload = z.infer<typeof storedPayloadSchema>;

function serializePayload(record: IdentityVerificationRecord): string {
  const payload: StoredPayload = {
    v: 1,
    verificationId: record.verificationId,
    userId: record.userId,
    identifierId: record.identifierId,
    tokenHash: record.tokenHash,
    codeChallenge: record.codeChallenge,
  };
  return JSON.stringify(payload);
}

function parsePayload(raw: string): StoredPayload | null {
  try {
    const result = storedPayloadSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export class PrismaIdentityVerificationRepository
  implements IdentityVerificationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async replaceForIdentifier(
    record: IdentityVerificationRecord,
  ): Promise<void> {
    const identifier = keyFor(record.identifierId);
    // One transaction, so a mint is never observed as a gap between the
    // delete and the insert. It does not make the pair atomic against a
    // CONCURRENT mint — nothing here can, without a unique key — which is why
    // `consume` reaps the generations it reads rather than trusting this.
    await this.prisma.$transaction([
      this.prisma.verificationToken.deleteMany({ where: { identifier } }),
      this.prisma.verificationToken.create({
        data: {
          identifier,
          token: serializePayload(record),
          expires: new Date(record.expiresAtMs),
        },
      }),
    ]);
  }

  async findByIdentifierId({
    identifierId,
  }: {
    identifierId: string;
  }): Promise<IdentityVerificationRecord | null> {
    const row = await this.prisma.verificationToken.findFirst({
      where: { identifier: keyFor(identifierId) },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    const payload = parsePayload(row.token);
    if (!payload) return null;
    return {
      verificationId: payload.verificationId,
      userId: payload.userId,
      identifierId: payload.identifierId,
      tokenHash: payload.tokenHash,
      codeChallenge: payload.codeChallenge,
      expiresAtMs: row.expires.getTime(),
    };
  }

  async consume({
    identifierId,
    verificationId,
  }: {
    identifierId: string;
    verificationId: string;
  }): Promise<boolean> {
    const identifier = keyFor(identifierId);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.verificationToken.findMany({
        where: { identifier },
        orderBy: { createdAt: "desc" },
      });
      // The same newest-row rule `findByIdentifierId` reads by, so completion
      // is checked against the record it was offered.
      const current = rows[0];
      if (!current) return false;
      const payload = parsePayload(current.token);
      if (!payload || payload.verificationId !== verificationId) return false;
      // Every row this read saw, not just the pair — and that is the whole
      // point. `identifier` carries no unique constraint, so two mints racing
      // each other both find nothing to replace and both insert; the newest
      // answers every read until it is consumed, and then the OLDER one
      // becomes selectable again, its token and PKCE proof intact. A record a
      // newer mint superseded must never complete, so consuming the current
      // generation reaps the generations behind it.
      //
      // Bounded to the ids this transaction read, so a mint that lands after
      // it is a fresh generation rather than collateral.
      const deleted = await tx.verificationToken.deleteMany({
        where: { identifier, token: { in: rows.map((row) => row.token) } },
      });
      // Single-use is this count: two completions of the same generation both
      // see the same rows, and exactly one deleteMany reports rows gone.
      return deleted.count > 0;
    });
  }
}
