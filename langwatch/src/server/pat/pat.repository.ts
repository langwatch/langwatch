import type { PrismaClient, PersonalAccessToken, RoleBinding } from "@prisma/client";

export type PatWithBindings = PersonalAccessToken & {
  roleBindings: RoleBinding[];
};

export class PatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): PatRepository {
    return new PatRepository(prisma);
  }

  async create({
    name,
    description,
    lookupId,
    hashedSecret,
    userId,
    organizationId,
    expiresAt,
  }: {
    name: string;
    description?: string | null;
    lookupId: string;
    hashedSecret: string;
    userId: string;
    organizationId: string;
    expiresAt?: Date | null;
  }): Promise<PersonalAccessToken> {
    return this.prisma.personalAccessToken.create({
      data: {
        name,
        description: description ?? null,
        lookupId,
        hashedSecret,
        userId,
        organizationId,
        expiresAt: expiresAt ?? null,
      },
    });
  }

  async findByLookupId({
    lookupId,
  }: {
    lookupId: string;
  }): Promise<PatWithBindings | null> {
    // Reject PATs whose owning user has been deactivated. We use findFirst
    // rather than findUnique because Prisma's findUnique does not accept
    // related filters; lookupId is @unique so the result is still unique.
    return this.prisma.personalAccessToken.findFirst({
      where: {
        lookupId,
        user: { deactivatedAt: null },
      },
      include: { roleBindings: true },
    });
  }

  async findById({
    id,
  }: {
    id: string;
  }): Promise<PatWithBindings | null> {
    return this.prisma.personalAccessToken.findUnique({
      where: { id },
      include: { roleBindings: true },
    });
  }

  async findAllByUser({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<PatWithBindings[]> {
    return this.prisma.personalAccessToken.findMany({
      where: { userId, organizationId },
      include: {
        roleBindings: {
          include: { customRole: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke({ id }: { id: string }): Promise<PersonalAccessToken> {
    return this.prisma.personalAccessToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async updateLastUsedAt({ id }: { id: string }): Promise<void> {
    await this.prisma.personalAccessToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Inserts all role bindings for a PAT in a single query.
   *
   * We use `createMany` (one INSERT … VALUES (…),(…),(…)) instead of N
   * serialized `create()` calls. The two realistic alternatives were:
   *
   *   - `Promise.all(bindings.map(create))` — N round-trips, cubic against
   *     the createMany path for any non-trivial bindings count. This was
   *     the previous implementation.
   *   - `Promise.allSettled(bindings.map(create))` — would surface
   *     per-row errors but break atomicity. A PAT that exists with only
   *     "most" of its intended bindings is strictly worse than no PAT:
   *     the user would believe they granted permissions they didn't.
   *
   * Callers run this inside the outer $transaction that created the PAT
   * row itself, so any single-row constraint failure rolls back the PAT
   * as well — all-or-nothing semantics preserved at the cost of
   * per-row error messages, which isn't information the API needs to
   * expose anyway (inputs are pre-validated upstream).
   */
  async createRoleBindings({
    patId,
    organizationId,
    bindings,
  }: {
    patId: string;
    organizationId: string;
    bindings: Array<{
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId?: string | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  }): Promise<{ count: number }> {
    if (bindings.length === 0) return { count: 0 };

    return this.prisma.roleBinding.createMany({
      data: bindings.map((b) => ({
        organizationId,
        patId,
        role: b.role,
        customRoleId: b.role === "CUSTOM" ? (b.customRoleId ?? null) : null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      })),
    });
  }
}
