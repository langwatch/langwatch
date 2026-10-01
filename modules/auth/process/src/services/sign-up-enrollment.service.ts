import { NoAddressToConfirmError, type SignUpEnrollment } from "@langwatch/auth-contract";
import {
  isOrganizationManagedDecision,
  normalizeIdentifierValue,
  type RoutingDecision,
  type SignInMethod,
  type SignInRoutingReasonCode,
} from "@langwatch/identity-contract";

export interface SignUpEnrollmentServiceDeps {
  validateAddressProof(input: { token: string; email: string }): Promise<boolean>;
  /** An unconfirmed proof, live only while the installation cannot send email. */
  validateUnconfirmedAddressProof(input: { token: string; email: string }): Promise<boolean>;
  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision>;
  addressIsTaken(input: { email: string }): Promise<boolean>;
  resolveDefaultMethods(): Promise<readonly SignInMethod[]>;
  passwordIsAllowed(): Promise<boolean>;
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

  private async decide({ email }: { email: string }): Promise<SignUpEnrollment> {
    const decision = await this.deps.route({ identifier: email, breakGlass: false });
    if (decision.outcome === "redirect_to_connection") {
      return {
        outcome: "redirect",
        methodSet: decision.methodSet,
        reasonCode: decision.reasonCode,
      };
    }
    if (isOrganizationManagedDecision(decision)) return unavailable(decision.reasonCode);

    if (await this.deps.addressIsTaken({ email: normalizeIdentifierValue(email) })) {
      return { outcome: "existing_account", methodSet: [], reasonCode: "account_methods" };
    }

    const offered = await this.offeredMethods(decision);
    if (offered === null) return unavailable(decision.reasonCode);

    const methodSet = (await this.deps.passwordIsAllowed())
      ? offered
      : offered.filter((method) => method.kind !== "password");
    if (methodSet.length === 0) return unavailable(decision.reasonCode);

    return { outcome: "enroll", methodSet, reasonCode: decision.reasonCode };
  }

  private async offeredMethods(decision: RoutingDecision): Promise<readonly SignInMethod[] | null> {
    if (decision.outcome === "route_to_signup") return this.deps.resolveDefaultMethods();
    if (
      decision.reasonCode === "method_not_licensed" ||
      decision.reasonCode === "method_not_configured"
    ) {
      return decision.methodSet;
    }

    return null;
  }
}

function unavailable(reasonCode: SignInRoutingReasonCode): SignUpEnrollment {
  return { outcome: "unavailable", methodSet: [], reasonCode };
}
