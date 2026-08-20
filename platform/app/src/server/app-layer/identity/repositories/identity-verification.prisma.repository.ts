import type { PrismaClient } from "~/generated/prisma/client";
import type {
  IdentityVerificationRecord,
  IdentityVerificationStore,
  VerifiableIdentifierReads,
} from "../verification-ceremony";

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

interface StoredPayload {
  v: 1;
  verificationId: string;
  userId: string;
  identifierId: string;
  tokenHash: string;
  codeChallenge: string;
}

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
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.verificationId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.identifierId !== "string" ||
      typeof parsed.tokenHash !== "string" ||
      typeof parsed.codeChallenge !== "string"
    ) {
      return null;
    }
    return parsed as StoredPayload;
  } catch {
    return null;
  }
}

export class PrismaIdentityVerificationRepository
  implements IdentityVerificationStore
{
  constructor(private readonly prisma: PrismaClient) {}

  async replaceForIdentifier(
    record: IdentityVerificationRecord,
  ): Promise<void> {
    const identifier = keyFor(record.identifierId);
    await this.prisma.verificationToken.deleteMany({ where: { identifier } });
    await this.prisma.verificationToken.create({
      data: {
        identifier,
        token: serializePayload(record),
        expires: new Date(record.expiresAtMs),
      },
    });
  }

  async findByIdentifierId(params: {
    identifierId: string;
  }): Promise<IdentityVerificationRecord | null> {
    const row = await this.prisma.verificationToken.findFirst({
      where: { identifier: keyFor(params.identifierId) },
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

  async consume(params: {
    identifierId: string;
    verificationId: string;
  }): Promise<boolean> {
    const identifier = keyFor(params.identifierId);
    const row = await this.prisma.verificationToken.findFirst({
      where: { identifier },
    });
    if (!row) return false;
    const payload = parsePayload(row.token);
    if (!payload || payload.verificationId !== params.verificationId) {
      return false;
    }
    // Single-use is this delete: two concurrent completions race on the exact
    // (identifier, token) pair and exactly one deleteMany reports a row gone.
    const deleted = await this.prisma.verificationToken.deleteMany({
      where: { identifier, token: row.token },
    });
    return deleted.count > 0;
  }
}

/** The mint guard's read of the Identifier projection (fold-written rows). */
export class PrismaVerifiableIdentifierReads
  implements VerifiableIdentifierReads
{
  constructor(private readonly prisma: PrismaClient) {}

  async findIdentifier(params: {
    userId: string;
    identifierId: string;
  }): Promise<{ provider: string; state: string } | null> {
    return this.prisma.identifier.findFirst({
      where: { id: params.identifierId, userId: params.userId },
      select: { provider: true, state: true },
    });
  }
}
