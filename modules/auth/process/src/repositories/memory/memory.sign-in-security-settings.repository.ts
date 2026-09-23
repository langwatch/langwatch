import { NO_LOCKOUT, NO_SESSION_BOUND } from "@langwatch/auth-contract";

import type {
  OrganizationSignInSecurityRule,
  SignInSecuritySettingsRepository,
} from "../sign-in-security-settings.repository.ts";

const unconfigured = (): OrganizationSignInSecurityRule => ({
  lockout: NO_LOCKOUT,
  sessionBound: NO_SESSION_BOUND,
});

const asksNothing = (rule: OrganizationSignInSecurityRule): boolean =>
  rule.lockout.afterFailedAttempts <= 0 &&
  rule.sessionBound.idleTimeoutMinutes <= 0 &&
  rule.sessionBound.maxLifetimeMinutes <= 0;

/**
 * In-process twin of the organization's four sign-in security columns.
 * `memberships` is what `findForUser` filters on, so a deployment booted on
 * memory answers "which rule governs this person" the same way Postgres does.
 */
export class MemorySignInSecuritySettingsRepository implements SignInSecuritySettingsRepository {
  readonly rules = new Map<string, OrganizationSignInSecurityRule>();
  readonly memberships = new Map<string, Set<string>>();

  private constructor() {}

  static create(): MemorySignInSecuritySettingsRepository {
    return new MemorySignInSecuritySettingsRepository();
  }

  /** Puts a person in an organization, as the Postgres twin's join does. */
  join({ userId, organizationId }: { userId: string; organizationId: string }): void {
    const joined = this.memberships.get(userId) ?? new Set<string>();
    joined.add(organizationId);
    this.memberships.set(userId, joined);
  }

  async findForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly OrganizationSignInSecurityRule[]> {
    return [...(this.memberships.get(userId) ?? [])].map(
      (organizationId) => this.rules.get(organizationId) ?? unconfigured(),
    );
  }

  async findConfigured(): Promise<readonly OrganizationSignInSecurityRule[]> {
    return [...this.rules.values()].filter((rule) => !asksNothing(rule));
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly OrganizationSignInSecurityRule[]> {
    const rule = this.rules.get(organizationId);

    return rule === undefined ? [] : [rule];
  }

  async save({
    organizationId,
    rule,
  }: {
    organizationId: string;
    rule: OrganizationSignInSecurityRule;
  }): Promise<void> {
    this.rules.set(organizationId, rule);
  }
}
