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
    // One transaction: a concurrent mint must never leave two records for
    // the identifier, which the two reads below could otherwise pick apart.
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
    // The same newest-row rule `findByIdentifierId` reads by, so completion
    // consumes the record it was checked against.
    const row = await this.prisma.verificationToken.findFirst({
      where: { identifier },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return false;
    const payload = parsePayload(row.token);
    if (!payload || payload.verificationId !== verificationId) return false;
    // Single-use is this delete: two concurrent completions race on the exact
    // (identifier, token) pair and exactly one deleteMany reports a row gone.
    const deleted = await this.prisma.verificationToken.deleteMany({
      where: { identifier, token: row.token },
    });
    return deleted.count > 0;
  }
}
