import { NoAddressToConfirmError, type SignUpEnrollment } from "@langwatch/auth-contract";
import {
  normalizeIdentifierValue,
  type RoutingDecision,
  type SignInMethod,
} from "@langwatch/identity-contract";
import { SignUpRestrictedError, type SignUpVerdict } from "@langwatch/organization-contract";

import { decideLocalSignUp, isSettledByRouting } from "../rules/local-sign-up.rules.ts";

interface SignUpEnrollmentServiceDeps {
  validateAddressProof(input: { token: string; email: string }): Promise<boolean>;
  /** An unconfirmed proof, live only while the installation cannot send email. */
  validateUnconfirmedAddressProof(input: { token: string; email: string }): Promise<boolean>;
  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision>;
  addressIsTaken(input: { email: string }): Promise<boolean>;
  resolveDefaultMethods(): Promise<readonly SignInMethod[]>;
  passwordIsAllowed(): Promise<boolean>;
  /** Whether the installation admits a new account for this address. */
  checkSignUp(input: Readonly<{ email: string }>): Promise<SignUpVerdict>;
}

/**
 * Which methods a proven sign-up address may enrol, main's `decideLocalSignUp`
 * (specs/identity/signin-signup-screens.feature). The proof is checked, never spent.
 */
export class SignUpEnrollmentService {
  static create(deps: SignUpEnrollmentServiceDeps): SignUpEnrollmentService {
    return new SignUpEnrollmentService(deps);
  }

  private constructor(private readonly deps: SignUpEnrollmentServiceDeps) {}

  async getEnrollment({
    email,
    addressProof,
  }: {
    email: string;
    addressProof: string;
  }): Promise<SignUpEnrollment> {
    const proof = { token: addressProof, email };
    if (await this.deps.validateAddressProof(proof)) return this.decide({ email });

    // Passkey sign-up requires a confirmed proof, so an unconfirmed one never enrols one.
    if (await this.deps.validateUnconfirmedAddressProof(proof)) {
      const decision = await this.decide({ email });
      return {
        ...decision,
        methodSet: decision.methodSet.filter((method) => method.kind !== "passkey"),
      };
    }

    throw new NoAddressToConfirmError();
  }

  /**
   * Whether this address may still enrol `method` here, asked again at a ceremony's two ends. The
   * proof is neither checked nor spent; an existing account is left to the caller's own refusal.
   */
  async enrolsLocally({
    email,
    method,
  }: {
    email: string;
    method: SignInMethod["kind"];
  }): Promise<boolean> {
    const decision = await this.localDecision({ email });
    if (decision.outcome === "existing_account") return true;
    return (
      decision.outcome === "enroll" && decision.methodSet.some((offered) => offered.kind === method)
    );
  }

  private async decide({ email }: { email: string }): Promise<SignUpEnrollment> {
    const decision = await this.localDecision({ email });
    if (decision.outcome !== "enroll") return decision;

    const verdict = await this.deps.checkSignUp({ email });
    if (!verdict.allowed) throw new SignUpRestrictedError(verdict.reason);

    return decision;
  }

  private async localDecision({ email }: { email: string }): Promise<SignUpEnrollment> {
    const decision = await this.deps.route({ identifier: email, breakGlass: false });
    // An organization's address is answered by routing alone, with no account looked up.
    if (isSettledByRouting(decision)) {
      return decideLocalSignUp({
        decision,
        addressIsTaken: false,
        defaultMethods: [],
        passwordIsAllowed: false,
      });
    }

    return decideLocalSignUp({
      decision,
      addressIsTaken: await this.deps.addressIsTaken({ email: normalizeIdentifierValue(email) }),
      defaultMethods:
        decision.outcome === "route_to_signup" ? await this.deps.resolveDefaultMethods() : [],
      passwordIsAllowed: await this.deps.passwordIsAllowed(),
    });
  }
}
