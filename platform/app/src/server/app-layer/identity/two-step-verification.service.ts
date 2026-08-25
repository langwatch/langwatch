import { IdentityMfaRequiredByOrganizationError } from "@langwatch/identity";

/**
 * The account side of two-step verification (D06): what a person's own
 * security screen may read, and the one write it may make that better-auth's
 * endpoints cannot make on their own.
 *
 * Setting one up, confirming it, generating backup codes and answering a
 * challenge all go straight to the two-factor plugin's endpoints, which do
 * them correctly and at rest. Nothing here reimplements any of that.
 *
 * Turning it OFF is the exception, and the reason is the organization: a
 * person who belongs to one that requires a second factor may not turn theirs
 * off, and better-auth has no idea our organizations exist. So the refusal
 * lives here, in front of the plugin's own disable, where it is enforced
 * rather than merely offered.
 */

/** An organization that will not let this person turn it off. */
export interface RequiringOrganization {
  organizationId: string;
  name: string;
  slug: string;
}

export interface TwoStepAccountPort {
  /** Whether the person finished a setup — the plugin's own row-truth. */
  enrollmentEnabled(args: { userId: string }): Promise<boolean>;
  /** How many passkeys they hold, for the copy at a gate. */
  passkeyCount(args: { userId: string }): Promise<number>;
  /**
   * The organizations this person belongs to that require a second factor.
   * Read here rather than trusted from the caller, so somebody working from a
   * stale membership list cannot turn the factor off and keep the access.
   */
  requiringOrganizations(args: {
    userId: string;
  }): Promise<readonly RequiringOrganization[]>;
}

/**
 * The two-factor plugin's own endpoints, as a port.
 *
 * Both calls re-prove something the person already has — a current code, and
 * the password — and both refuse in better-auth's vocabulary, which the
 * adapter translates into ours through the one mapping table.
 */
export interface TwoStepProtocolPort {
  verifyCode(args: { headers: Headers; code: string }): Promise<void>;
  disable(args: { headers: Headers; password?: string }): Promise<void>;
}

export interface TwoStepVerificationServiceDeps {
  account: TwoStepAccountPort;
  protocol: TwoStepProtocolPort;
  /** Whether this deployment offers it at all — the flag, stated once. */
  offered: () => boolean;
}

/** What the security screen renders itself from. */
export interface TwoStepAccountStanding {
  offered: boolean;
  enabled: boolean;
  holdsPasskey: boolean;
  requiringOrganizations: readonly RequiringOrganization[];
}

export class TwoStepVerificationService {
  constructor(private readonly deps: TwoStepVerificationServiceDeps) {}

  /** Where this person stands, for their own security screen. */
  async standingFor({
    userId,
  }: {
    userId: string;
  }): Promise<TwoStepAccountStanding> {
    if (!this.deps.offered()) {
      // Nothing about it exists on this deployment, and the screen renders
      // nothing rather than a setup nobody can finish.
      return {
        offered: false,
        enabled: false,
        holdsPasskey: false,
        requiringOrganizations: [],
      };
    }
    const [enabled, passkeyCount, requiringOrganizations] = await Promise.all([
      this.deps.account.enrollmentEnabled({ userId }),
      this.deps.account.passkeyCount({ userId }),
      this.deps.account.requiringOrganizations({ userId }),
    ]);
    return {
      offered: true,
      enabled,
      holdsPasskey: passkeyCount > 0,
      requiringOrganizations,
    };
  }

  /**
   * Turn it off, with the password and a current code.
   *
   * The organization refusal comes FIRST, before either proof is spent: a
   * person who cannot turn it off should be told why rather than made to
   * fetch a code for a request that was never going to succeed.
   */
  async disable({
    userId,
    password,
    code,
    headers,
  }: {
    userId: string;
    /** Absent for an account that holds no password to re-prove with. */
    password?: string;
    code: string;
    headers: Headers;
  }): Promise<{ disabled: true }> {
    const requiring = await this.deps.account.requiringOrganizations({
      userId,
    });
    if (requiring.length > 0) {
      throw new IdentityMfaRequiredByOrganizationError(
        `disable_two_step: ${userId} belongs to ${requiring.length} organization(s) requiring a second factor: ${requiring
          .map((organization) => organization.slug)
          .join(", ")}`,
      );
    }
    await this.deps.protocol.verifyCode({ headers, code });
    await this.deps.protocol.disable({ headers, password });
    return { disabled: true };
  }
}
