import type { PrismaClient, PersonalAccessToken } from "@prisma/client";
import { PatRepository, type PatWithBindings } from "./pat.repository";
import {
  generatePatToken,
  splitPatToken,
  verifySecret,
} from "./pat-token.utils";

export class PatService {
  private readonly repo: PatRepository;
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.repo = PatRepository.create(prisma);
  }

  static create(prisma: PrismaClient): PatService {
    return new PatService(prisma);
  }

  /**
   * Creates a new PAT with the given role bindings inside a transaction.
   * Returns the plaintext token (shown once) plus the persisted record.
   */
  async create({
    name,
    description,
    userId,
    organizationId,
    expiresAt,
    bindings,
  }: {
    name: string;
    description?: string | null;
    userId: string;
    organizationId: string;
    expiresAt?: Date | null;
    bindings: Array<{
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId?: string | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  }): Promise<{ token: string; pat: PersonalAccessToken }> {
    const { token, lookupId, hashedSecret } = generatePatToken();

    const pat = await this.prisma.$transaction(async (tx) => {
      const txRepo = PatRepository.create(tx as PrismaClient);

      const created = await txRepo.create({
        name,
        description,
        lookupId,
        hashedSecret,
        userId,
        organizationId,
        expiresAt,
      });

      if (bindings.length > 0) {
        await txRepo.createRoleBindings({
          patId: created.id,
          organizationId,
          bindings,
        });
      }

      return created;
    });

    return { token, pat };
  }

  /**
   * Verifies a PAT token string and returns the token record if valid.
   * Returns null if the token is invalid, revoked, or not found.
   *
   * Does NOT update lastUsedAt — callers should call markUsed() after
   * confirming the request is fully authorized (e.g., project resolved).
   */
  async verify({
    token,
  }: {
    token: string;
  }): Promise<PatWithBindings | null> {
    const parts = splitPatToken(token);
    if (!parts) return null;

    const pat = await this.repo.findByLookupId({ lookupId: parts.lookupId });
    if (!pat) return null;

    // Revoked tokens are rejected
    if (pat.revokedAt) return null;

    // Expired tokens are rejected
    if (pat.expiresAt && pat.expiresAt < new Date()) return null;

    // Verify the secret portion
    if (!verifySecret(parts.secret, pat.hashedSecret)) return null;

    return pat;
  }

  /**
   * Fire-and-forget lastUsedAt update. Call after full authorization succeeds.
   */
  markUsed({ id }: { id: string }): void {
    void this.repo.updateLastUsedAt({ id });
  }

  /**
   * Lists all PATs for a user within an organization.
   */
  async list({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<PatWithBindings[]> {
    return this.repo.findAllByUser({ userId, organizationId });
  }

  /**
   * Revokes a PAT by setting revokedAt. Never hard-deletes.
   */
  async revoke({
    id,
    userId,
  }: {
    id: string;
    userId: string;
  }): Promise<PersonalAccessToken> {
    // Verify ownership
    const pat = await this.repo.findById({ id });
    if (!pat) throw new Error("PAT not found");
    if (pat.userId !== userId) throw new Error("Not authorized to revoke this PAT");
    if (pat.revokedAt) throw new Error("PAT is already revoked");

    return this.repo.revoke({ id });
  }

  /**
   * Gets a single PAT by ID (for display, not verification).
   */
  async getById({ id }: { id: string }): Promise<PatWithBindings | null> {
    return this.repo.findById({ id });
  }
}
