import type { PrismaClient, User } from "@prisma/client";
import { revokeAllSessionsForUser } from "../better-auth/revokeSessions";

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): UserService {
    return new UserService(prisma);
  }

  async findById({ id }: { id: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail({ email }: { email: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create({ name, email }: { name: string; email: string }): Promise<User> {
    return this.prisma.user.create({ data: { name, email } });
  }

  /**
   * Update a user's profile. If the email is changed, force-revoke all
   * the user's existing sessions: BetterAuth caches the user object
   * (including email) in Redis, and the cached email would otherwise
   * remain stale until the cache TTL expires (up to 30 days). Stale
   * email matters for the invite-accept flow which compares
   * `session.user.email` to `invite.email`, and for any UI that relies
   * on the displayed identity matching what's in the DB. SCIM-driven
   * email changes (the only path that calls this method today) are
   * always treated as a hard "re-authenticate as the new identity"
   * event by the IdP, so revoking sessions is the right behavior.
   *
   * Name-only changes do NOT trigger revocation — those are cosmetic
   * and don't warrant kicking the user out.
   */
  async updateProfile({ id, name, email }: { id: string; name?: string; email?: string }): Promise<User> {
    // Normalize the incoming email the same way BetterAuth does for
    // signup/signin (`findUserByEmail` in
    // node_modules/better-auth/dist/db/internal-adapter.mjs:
    // `email.toLowerCase()`). Otherwise a SCIM-provisioned update from
    // "alice@acme.com" → "Alice@Acme.com" would (a) trigger an unneeded
    // session revocation and (b) desync the stored email from what
    // BetterAuth's signin lookup would find.
    const normalizedEmail =
      email !== undefined ? email.trim().toLowerCase() : undefined;

    let emailChanged = false;
    if (normalizedEmail !== undefined) {
      const current = await this.prisma.user.findUnique({
        where: { id },
        select: { email: true },
      });
      emailChanged = (current?.email ?? "").toLowerCase() !== normalizedEmail;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(normalizedEmail !== undefined && { email: normalizedEmail }),
      },
    });

    if (emailChanged) {
      await revokeAllSessionsForUser({ prisma: this.prisma, userId: id });
    }

    return updated;
  }

  async getSsoStatus({ id }: { id: string }): Promise<{ pendingSsoSetup: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { pendingSsoSetup: true },
    });
    return { pendingSsoSetup: user?.pendingSsoSetup ?? false };
  }

  /**
   * Deactivate a user AND force-logout all their existing sessions.
   *
   * The session revocation is critical: BetterAuth caches sessions in
   * Redis and reads from cache before falling back to the DB, so a
   * `deactivatedAt` update alone is invisible to ongoing sessions for
   * up to 30 days. Every deactivation path (tRPC, SCIM webhook, SCIM
   * provisioning sync) routes through here so they all benefit from the
   * cache invalidation. See `src/server/better-auth/revokeSessions.ts`
   * for the underlying mechanism and iter-24 progress notes for the
   * full bug history.
   */
  async deactivate({ id }: { id: string }): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { deactivatedAt: new Date() },
    });
    await revokeAllSessionsForUser({ prisma: this.prisma, userId: id });
    return user;
  }

  async reactivate({ id }: { id: string }): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { deactivatedAt: null } });
  }
}
