/**
 * Who may create an account on this installation, and who may found an
 * organization once they have one (specs/auth/sign-up-restriction.feature).
 *
 * Two settings drive it:
 *
 *   - `SIGN_UP_MODE`: `open` (the default) lets anybody who can reach the
 *     installation create an account. `invite_only` lets an account be created
 *     only for an address that holds a pending invitation.
 *   - `SIGN_UP_ALLOWED_DOMAINS`: a comma-separated list of email domains. When
 *     set, an address outside it cannot create an account, in either mode.
 *
 * Exceptions, in the order they are checked:
 *
 *   1. An address listed in `ADMIN_EMAILS` may always sign up. This is how the
 *      first administrator of an invite-only installation gets in.
 *   2. An address with a pending, unexpired invitation may always sign up,
 *      whatever its domain: an administrator chose to invite it.
 *   3. With `ADMIN_EMAILS` empty, the first account on an installation with no
 *      users at all is allowed, so an invite-only installation can still be
 *      bootstrapped. Setting `ADMIN_EMAILS` closes that window.
 *
 * The default configuration answers without a database read, so an
 * installation that sets neither variable behaves exactly as before.
 */
import { createLogger } from "@langwatch/observability";
import { SignUpRestrictedError } from "~/server/auth/errors";

const logger = createLogger("langwatch:identity:sign-up-policy");

const SIGN_UP_MODES = ["open", "invite_only"] as const;
export type SignUpMode = (typeof SIGN_UP_MODES)[number];

export interface SignUpPolicyConfig {
  mode: SignUpMode;
  /** Lowercased, without a leading `@`; empty means any domain. */
  allowedDomains: readonly string[];
  /** Lowercased `ADMIN_EMAILS`. */
  adminEmails: readonly string[];
}

export interface SignUpPolicyRepository {
  /** Whether a PENDING, unexpired invitation exists for this address in any
   *  organization. */
  hasPendingInvite(args: { email: string }): Promise<boolean>;
  /** Whether the installation holds at least one user. */
  anyUserExists(): Promise<boolean>;
  /** Whether the installation holds at least one organization. */
  anyOrganizationExists(): Promise<boolean>;
}

export type SignUpVerdict =
  | {
      allowed: true;
      via: "open" | "instance_admin" | "invitation" | "first_account";
    }
  | { allowed: false; reason: "invite_only" | "domain_not_allowed" };

export type OrganizationCreationVerdict =
  | { allowed: true; via: "open" | "instance_admin" | "first_organization" }
  | { allowed: false; reason: "invite_only" };

/** `SIGN_UP_ALLOWED_DOMAINS` as a list: trimmed, lowercased, `@` dropped. */
export function parseAllowedDomains(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter((domain) => domain.length > 0);
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1);
}

export class SignUpPolicy {
  constructor(
    private readonly deps: {
      config: () => SignUpPolicyConfig;
      repository: SignUpPolicyRepository;
    },
  ) {}

  /** Whether `email` may create a new account here. */
  async checkSignUp({ email }: { email: string }): Promise<SignUpVerdict> {
    const config = this.deps.config();
    const address = email.trim().toLowerCase();

    const inviteOnly = config.mode === "invite_only";
    if (!inviteOnly && config.allowedDomains.length === 0) {
      return { allowed: true, via: "open" };
    }
    if (config.adminEmails.includes(address)) {
      return { allowed: true, via: "instance_admin" };
    }
    if (await this.deps.repository.hasPendingInvite({ email: address })) {
      return { allowed: true, via: "invitation" };
    }
    if (
      config.allowedDomains.length > 0 &&
      !config.allowedDomains.includes(domainOf(address))
    ) {
      return { allowed: false, reason: "domain_not_allowed" };
    }
    if (!inviteOnly) {
      return { allowed: true, via: "open" };
    }
    if (
      config.adminEmails.length === 0 &&
      !(await this.deps.repository.anyUserExists())
    ) {
      return { allowed: true, via: "first_account" };
    }
    return { allowed: false, reason: "invite_only" };
  }

  /** {@link checkSignUp}, throwing the handled refusal when it says no. */
  async assertSignUp({ email }: { email: string }): Promise<void> {
    const verdict = await this.checkSignUp({ email });
    if (verdict.allowed) return;
    logger.info(
      { reason: verdict.reason },
      "sign-up refused by the installation's sign-up policy",
    );
    throw new SignUpRestrictedError(verdict.reason);
  }

  /**
   * Whether the signed-in `email` may found a new organization.
   *
   * In `invite_only` mode a member joins the organizations that invited them;
   * founding another one is for instance administrators, and for the first
   * organization on a fresh installation.
   */
  async checkOrganizationCreation({
    email,
  }: {
    email: string | null | undefined;
  }): Promise<OrganizationCreationVerdict> {
    const config = this.deps.config();
    if (config.mode !== "invite_only") return { allowed: true, via: "open" };

    const address = (email ?? "").trim().toLowerCase();
    if (address && config.adminEmails.includes(address)) {
      return { allowed: true, via: "instance_admin" };
    }
    if (!(await this.deps.repository.anyOrganizationExists())) {
      return { allowed: true, via: "first_organization" };
    }
    return { allowed: false, reason: "invite_only" };
  }
}
