import { CliTokenRevocationService } from "@ee/governance/services/cliTokenRevocation.service";
import { PrismaLegacySsoOrganizationRepository } from "@ee/sso/legacy-sso-organization.prisma.repository";
import {
  configuredSsoProviderStatus,
  extractEmailDomain,
  type OrganizationSsoProviderLookup,
} from "@ee/sso/matching";

import type { PrismaClient, User } from "~/generated/prisma/client";

import { sessionRevocation } from "../app-layer/identity/runtime";
import type { SessionRevocationService } from "../app-layer/identity/session-revocation.service";

/** The collaborators a caller may hand in; each defaults over `prisma`. */
interface UserServiceCollaborators {
  cliTokenRevocation?: CliTokenRevocationService;
  /**
   * Composed over this service's OWN client rather than the app's, so a
   * caller handing in a client — every test here does — revokes against the
   * one it handed in.
   */
  sessions?: SessionRevocationService;
  /**
   * The same legacy `ssoDomain`/`ssoProvider` lookup the sign-in hooks
   * read, injected so a test can fake it without a database.
   */
  legacySsoOrganizations?: OrganizationSsoProviderLookup;
}

export class UserService {
  private readonly cliTokenRevocation: CliTokenRevocationService;
  private readonly sessions: SessionRevocationService;
  private readonly legacySsoOrganizations: OrganizationSsoProviderLookup;

  constructor(
    private readonly prisma: PrismaClient,
    collaborators: UserServiceCollaborators = {},
  ) {
    this.cliTokenRevocation =
      collaborators.cliTokenRevocation ?? CliTokenRevocationService.create();
    this.sessions = collaborators.sessions ?? sessionRevocation({ prisma });
    this.legacySsoOrganizations =
      collaborators.legacySsoOrganizations ??
      new PrismaLegacySsoOrganizationRepository(prisma);
  }

  static create(prisma: PrismaClient): UserService {
    return new UserService(prisma);
  }

  async findById({ id }: { id: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail({ email }: { email: string }): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create({
    name,
    email,
    active = true,
  }: {
    name: string;
    email: string;
    active?: boolean;
  }): Promise<User> {
    return this.prisma.user.create({
      data: { name, email, ...(!active && { deactivatedAt: new Date() }) },
    });
  }

  /**
   * Update a user's profile. If the email is changed, force-revoke all
   * the user's existing sessions: BetterAuth caches the user object
   * (including email) in Redis, and the cached email would otherwise
   * remain stale until the cache TTL expires (up to 30 days). Stale
   * email matters for the invite-accept flow which compares
   * `session.user.email` to `invite.email`, and for any UI that relies
   * on the displayed identity matching what's in the DB. SCIM profiles are
   * organization-local and do not use this global account mutation.
   *
   * Name-only changes do NOT trigger revocation — those are cosmetic
   * and don't warrant kicking the user out.
   */
  async updateProfile({
    id,
    name,
    email,
  }: {
    id: string;
    name?: string;
    email?: string;
  }): Promise<User> {
    // Normalize the incoming email the same way BetterAuth does for
    // signup/signin (`findUserByEmail` in
    // node_modules/better-auth/dist/db/internal-adapter.mjs:
    // `email.toLowerCase()`). Otherwise an update from
    // "alice@acme.com" → "Alice@Acme.com" would (a) trigger an unneeded
    // session revocation and (b) desync the stored email from what
    // BetterAuth's signin lookup would find.
    const normalizedEmail =
      email !== undefined ? email.trim().toLowerCase() : undefined;

    // Reject blank email after normalization. Without this, a whitespace-only
    // input like "   " becomes "" and persists an empty string into User.email
    // before revoking every session. Both the admin panel and SCIM sync share
    // this code path. Caught by CodeRabbit in PR review.
    if (normalizedEmail === "") {
      throw new Error("Email cannot be blank");
    }

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
      await this.sessions.revokeAll({ userId: id });
    }

    return updated;
  }

  async getAccountInfo({
    id,
  }: {
    id: string;
  }): Promise<{ createdAt: Date } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { createdAt: true },
    });
    return user ? { createdAt: user.createdAt } : null;
  }

  /**
   * A live answer, not a stored one: the flag on `User.pendingSsoSetup` is
   * set once at sign-in and otherwise only ever cleared by a later sign-in
   * (see `clearPendingSsoSetupForConfiguredProvider` in
   * `../better-auth/hooks.ts`) — so a member whose next correct sign-in never
   * happened to fire that clearing branch would otherwise carry the flag
   * forever, even after they already hold a sign-in that satisfies their
   * organization's SSO requirement.
   *
   * This read re-asks the identical question the hook asks
   * (`configuredSsoProviderStatus`, shared so the two can never disagree on
   * what a match is) against every account the user already holds, rather
   * than trusting the stored flag once it is true. It never writes: the flag
   * itself is left alone here, and the hooks still clear it in the database
   * on the next sign-in.
   *
   * Known gap: this only re-checks the legacy `ssoDomain`/`ssoProvider`
   * pin. A member admitted through the newer `SsoConnection` path (the
   * `ssoMigration`/`ssoArrival` branches in the hooks) is not re-checked
   * here — reaching that decision needs the SSO arrival/connection services,
   * which this service has no clean way to reach without crossing layers.
   */
  async getSsoStatus({
    id,
  }: {
    id: string;
  }): Promise<{ pendingSsoSetup: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { pendingSsoSetup: true, email: true },
    });
    if (!user?.pendingSsoSetup) return { pendingSsoSetup: false };

    const domain = extractEmailDomain(user.email);
    if (!domain) return { pendingSsoSetup: true };

    const accounts = await this.prisma.account.findMany({
      where: { userId: id },
      select: { provider: true, providerAccountId: true },
    });

    // Only a pin that still exists can still be pending: an organization that
    // has dropped its provider since the flag was set leaves nothing to link.
    const status = await configuredSsoProviderStatus({
      organizations: this.legacySsoOrganizations,
      domain,
      accounts: accounts.map((account) => ({
        providerId: account.provider,
        accountId: account.providerAccountId,
      })),
    });

    return { pendingSsoSetup: status === "unmatched" };
  }

  /**
   * Deactivate a user AND force-logout all their existing sessions
   * (browser AND CLI).
   *
   * Browser revocation: BetterAuth caches sessions in Redis and reads
   * from cache before falling back to the DB, so a `deactivatedAt`
   * update alone is invisible to ongoing sessions for up to 30 days.
   * Every deactivation path (tRPC, SCIM webhook, SCIM provisioning
   * sync) routes through here so they all benefit from the cache
   * invalidation. See
   * `src/server/app-layer/identity/session-revocation.service.ts`.
   *
   * CLI revocation: device-flow access + refresh tokens live in Redis
   * under `lwcli:access:*` / `lwcli:refresh:*` independently of
   * BetterAuth (minted by `/api/auth/cli/exchange`). Without this call
   * a deactivated user's CLI tokens would continue to authenticate
   * against the control plane until their TTLs expired (1h access /
   * 30d refresh). Spec:
   * specs/ai-gateway/cli-token-revoke-on-deactivation.feature.
   */
  async deactivate({ id }: { id: string }): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { deactivatedAt: new Date() },
    });
    await this.sessions.revokeAll({ userId: id });
    await this.cliTokenRevocation.revokeForUser({ userId: id });
    return user;
  }

  async reactivate({ id }: { id: string }): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { deactivatedAt: null },
    });
  }
}
