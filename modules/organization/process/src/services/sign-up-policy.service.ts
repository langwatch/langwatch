import type { AuthzApi } from "@langwatch/authz-contract";
/**
 * Who may create an account here, and who may found an organization, from
 * `SIGN_UP_MODE`, `SIGN_UP_ALLOWED_DOMAINS`, `SIGN_UP_DISPOSABLE_EMAILS` and `ADMIN_EMAILS`.
 * Specs: specs/auth/sign-up-restriction.feature, specs/auth/sign-up-disposable-email.feature
 */
import {
  OrganizationCreationRestrictedError,
  type OrganizationCreationVerdict,
  type PendingInvitationForCaller,
  type SignUpMode,
  type SignUpVerdict,
} from "@langwatch/organization-contract";

import type { SignUpPolicyRepository } from "../repositories/sign-up-policy.repository.ts";
import { isDisposableEmailDomain } from "../rules/disposable-email.rules.ts";

export interface SignUpPolicySettings {
  mode: SignUpMode;
  /** Lowercased, without a leading `@`; empty means any domain. */
  allowedDomains: readonly string[];
  /** `ADMIN_EMAILS`, as written. */
  adminEmails: readonly string[];
  /** Whether a new address on a disposable email domain is refused. */
  refuseDisposableEmails: boolean;
}

interface SignUpPolicyDependencies {
  settings: SignUpPolicySettings;
  repository: SignUpPolicyRepository;
  /** Whether an account holds the platform-operator grant: `ops:manage` on the platform. */
  authorization: Pick<AuthzApi, "can">;
  /** The addresses the caller has proven, read only on an invite-only installation. */
  findProvenAddresses(input: { userId: string }): Promise<readonly string[]>;
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1);
}

export class SignUpPolicyService {
  private readonly adminEmails: readonly string[];

  static create(dependencies: SignUpPolicyDependencies): SignUpPolicyService {
    return new SignUpPolicyService(dependencies);
  }

  private constructor(private readonly dependencies: SignUpPolicyDependencies) {
    this.adminEmails = dependencies.settings.adminEmails.map((email) => email.toLowerCase());
  }

  /** Whether `email` may create a new account here; `hasAnyAccount` comes from the caller. */
  async checkSignUp({
    email,
    hasAnyAccount,
  }: {
    email: string;
    hasAnyAccount: boolean;
  }): Promise<SignUpVerdict> {
    const { mode, allowedDomains, refuseDisposableEmails } = this.dependencies.settings;
    const address = email.trim().toLowerCase();
    const domain = domainOf(address);
    // A domain the operator lists in SIGN_UP_ALLOWED_DOMAINS is their decision, not a throwaway.
    const disposable =
      refuseDisposableEmails &&
      !allowedDomains.includes(domain) &&
      isDisposableEmailDomain({ domain });

    // The default configuration answers a permanent address without a database read.
    const inviteOnly = mode === "invite_only";
    if (!inviteOnly && allowedDomains.length === 0 && !disposable) {
      return { allowed: true, via: "open" };
    }
    if (this.adminEmails.includes(address)) {
      return { allowed: true, via: "instance_admin" };
    }
    // An invited address may sign up whatever its domain.
    const invited = await this.dependencies.repository.findPendingInviteCodes({ email: address });
    if (invited.length > 0) {
      return { allowed: true, via: "invitation" };
    }
    if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
      return { allowed: false, reason: "domain_not_allowed" };
    }
    if (disposable) {
      return { allowed: false, reason: "disposable_email" };
    }
    if (!inviteOnly) {
      return { allowed: true, via: "open" };
    }
    // With no `ADMIN_EMAILS`, the first account bootstraps the installation.
    if (this.adminEmails.length === 0 && !hasAnyAccount) {
      return { allowed: true, via: "first_account" };
    }
    return { allowed: false, reason: "invite_only" };
  }

  /**
   * Whether the signed-in caller may found a new organization. In
   * `invite_only` mode that is an instance administrator, or anyone while the
   * installation has no organization yet.
   */
  async checkOrganizationCreation({
    userId,
    email,
  }: {
    userId: string;
    email: string | null | undefined;
  }): Promise<OrganizationCreationVerdict> {
    if (this.dependencies.settings.mode !== "invite_only") return { allowed: true, via: "open" };

    const address = (email ?? "").trim().toLowerCase();
    if (address && this.adminEmails.includes(address)) {
      return { allowed: true, via: "instance_admin" };
    }
    const operator = await this.dependencies.authorization.can({
      principal: { type: "user", id: userId },
      permission: "ops:manage",
      scope: { type: "platform" },
    });
    if (operator) {
      return { allowed: true, via: "instance_admin" };
    }
    if (!(await this.dependencies.repository.hasAnyOrganization())) {
      return { allowed: true, via: "first_organization" };
    }
    return { allowed: false, reason: "invite_only" };
  }

  /** {@link checkOrganizationCreation}, throwing the handled refusal when it says no. */
  async assertOrganizationCreation(input: {
    userId: string;
    email: string | null | undefined;
  }): Promise<void> {
    const verdict = await this.checkOrganizationCreation(input);
    if (!verdict.allowed) throw new OrganizationCreationRestrictedError();
  }

  /**
   * The invitation a signed-in person with no organization should be sent to.
   * Answered only in `invite_only` mode, over addresses the account has proven.
   */
  async getPendingInvitation({
    userId,
    email,
  }: {
    userId: string;
    email: string | null | undefined;
  }): Promise<PendingInvitationForCaller> {
    if (this.dependencies.settings.mode !== "invite_only") return { inviteCode: null };

    const proven = await this.dependencies.findProvenAddresses({ userId });
    const fallback = email ? [email] : [];
    for (const address of proven.length > 0 ? proven : fallback) {
      const [inviteCode] = await this.dependencies.repository.findPendingInviteCodes({
        email: address.trim().toLowerCase(),
      });
      if (inviteCode) return { inviteCode };
    }
    return { inviteCode: null };
  }
}
