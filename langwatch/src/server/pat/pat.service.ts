import type { PrismaClient, PersonalAccessToken } from "@prisma/client";
import { PatRepository, type PatWithBindings } from "./pat.repository";
import {
  generatePatToken,
  splitPatToken,
  verifySecret,
} from "./pat-token.utils";

export class PatService {
  private readonly repo: PatRepository;

  constructor(prisma: PrismaClient) {
    this.repo = PatRepository.create(prisma);
  }

  static create(prisma: PrismaClient): PatService {
    return new PatService(prisma);
  }

  /**
   * Creates a new PAT with the given role bindings.
   * Returns the plaintext token (shown once) plus the persisted record.
   */
  async create({
    name,
    userId,
    organizationId,
    bindings,
  }: {
    name: string;
    userId: string;
    organizationId: string;
    bindings: Array<{
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId?: string | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  }): Promise<{ token: string; pat: PersonalAccessToken }> {
    const { token, lookupId, hashedSecret } = generatePatToken();

    const pat = await this.repo.create({
      name,
      lookupId,
      hashedSecret,
      userId,
      organizationId,
    });

    if (bindings.length > 0) {
      await this.repo.createRoleBindings({
        patId: pat.id,
        organizationId,
        bindings,
      });
    }

    return { token, pat };
  }

  /**
   * Verifies a PAT token string and returns the token record if valid.
   * Returns null if the token is invalid, revoked, or not found.
   * Updates lastUsedAt on successful verification.
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

    // Verify the secret portion
    if (!verifySecret(parts.secret, pat.hashedSecret)) return null;

    // Fire-and-forget lastUsedAt update — non-critical
    void this.repo.updateLastUsedAt({ id: pat.id });

    return pat;
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
