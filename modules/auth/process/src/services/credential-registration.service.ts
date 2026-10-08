/**
 * The signup form's door (D-A1U-2): auth decides whether an account may be minted and spends
 * the address proof; user writes the account. Spec: specs/licensing/sso-license-gating.feature.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  IdentityVerificationExpiredError,
  describePasswordProblem,
  routesToOrganizationConnection,
} from "@langwatch/identity-contract";
import { type OrganizationApi, SignUpRestrictedError } from "@langwatch/organization-contract";
import {
  type CreatedUser,
  type RegisterCredentialAccountInput,
  type UserApi,
  UserRegistrationNotAvailableError,
  UserSignupThrottledError,
} from "@langwatch/user-contract";

type AccountWrites = Pick<UserApi, "registerCredentialAccount">;
type SignUpPolicy = Pick<OrganizationApi, "checkSignUp">;
type RegistrationDoors = Pick<
  AuthApi,
  | "assertSignUpOrigin"
  | "resolveAuthProvider"
  | "route"
  | "isWithinBudget"
  | "claimSignUpAddressProof"
  | "claimUnconfirmedSignUpAddressProof"
>;

const SIGNUP_BUDGET = { windowSeconds: 60 * 60, max: 20 } as const;

type RegistrationPeers = Readonly<{
  users: AccountWrites;
  organizations: SignUpPolicy;
  auth: RegistrationDoors;
  issuesOwnPasswords: () => boolean;
}>;

export class CredentialRegistrationService {
  private constructor(private readonly peers: RegistrationPeers) {}

  static create(peers: RegistrationPeers): CredentialRegistrationService {
    return new CredentialRegistrationService(peers);
  }

  /**
   * Keyed off the RESOLVED provider, not the raw environment: the platform gate coerces to
   * email mode with no license (ADR-027 Decision 4), and blocking this kills recovery (5c).
   */
  async register(input: RegisterCredentialAccountInput): Promise<CreatedUser> {
    // Before anything is claimed or written: the sign-in that follows is refused on a foreign
    // origin, and an account created first would be left with nobody signed in to it.
    await this.peers.auth.assertSignUpOrigin({ origin: input.origin, referer: input.referer });

    // The same rules the form ran, carried as `fieldErrors` so the refusal lands on the box.
    const problem = describePasswordProblem(input.password);

    if (problem) {
      throw new ValidationError(problem, { meta: { fieldErrors: { password: [problem] } } });
    }

    // Sign-in lowercases the address on every lookup; the proof is bound to the same spelling.
    const email = input.email.toLowerCase();

    // D09: a deployment issuing its own passwords beside its provider passes too, except for
    // an address an organization routes to its own connection.
    const emailMode = (await this.peers.auth.resolveAuthProvider()) === "email";

    if (!emailMode && !this.peers.issuesOwnPasswords())
      throw new UserRegistrationNotAvailableError();
    if (!emailMode && (await this.#routesToConnection(email))) {
      throw new UserRegistrationNotAvailableError();
    }

    const allowance = await this.peers.auth.isWithinBudget({
      key: `user.register:${input.callerAddress}`,
      ...SIGNUP_BUDGET,
    });

    if (!allowance.allowed) throw new UserSignupThrottledError();

    // Before the proof is spent: a refused address keeps its link for the day an
    // administrator invites it.
    const verdict = await this.peers.organizations.checkSignUp({ email });

    if (!verdict.allowed) throw new SignUpRestrictedError(verdict.reason);

    // The mailbox proof is the authority to enrol a credential, bound to this exact address.
    const addressConfirmed = await this.#claimProof({ token: input.addressProof, email });

    return this.peers.users.registerCredentialAccount({
      name: input.name,
      email,
      password: input.password,
      addressConfirmed,
    });
  }

  /** Left to throw: for an address a company signs in, "could not tell" is no password. */
  async #routesToConnection(email: string): Promise<boolean> {
    return routesToOrganizationConnection(
      await this.peers.auth.route({ identifier: email, breakGlass: false }),
    );
  }

  /**
   * Spends the proof and answers whether it confirmed the address. An unconfirmed proof counts
   * only while the installation cannot send email (ADR-117, revision 2026-09-25).
   */
  async #claimProof(proof: { token: string; email: string }): Promise<boolean> {
    if (await this.peers.auth.claimSignUpAddressProof(proof)) return true;
    if (await this.peers.auth.claimUnconfirmedSignUpAddressProof(proof)) return false;

    throw new IdentityVerificationExpiredError();
  }
}
