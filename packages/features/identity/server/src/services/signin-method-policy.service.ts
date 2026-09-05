import type { SignInMethod, SignInMethodPolicy } from "@langwatch/identity-contract";
import type { SignInMethodPolicyPort } from "./signin-router.service";

/**
 * The instance's method-set policy (ADR-117 §4) — the module ADR-027's
 * routing gate moved into. `NEXTAUTH_PROVIDER` becomes the self-hosted
 * default method set; a second element can be added later without ending it.
 */

/**
 * What the deployment answers so the policy can be resolved.
 * `resolveAuthProvider` is ADR-027's single source of truth and MUST be the
 * one that already coerces a denied or unmounted provider to `"email"`.
 */
export interface SignInMethodPolicyInputs {
  /** `"email"`, or the federated provider id this deployment mounted. */
  resolveAuthProvider(): Promise<string>;
  /** Whether the licence carries federation. Memoized per process by its owner. */
  federationLicensed(): Promise<boolean>;
  /** Whether the passkey plugin was registered at boot. */
  offersPasskeys(): boolean;
  /** Whether this is a self-hosted deployment, which auto-redirects on its sole connection. */
  selfHosted(): boolean;
}

/** The credential form. Local by definition: this deployment authenticates. */
export const PASSWORD_METHOD: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};

/**
 * A passkey.
 */
export const PASSKEY_METHOD: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/** The instance's local method set — the break-glass and fallback door. */
export const LOCAL_METHOD_SET: readonly SignInMethod[] = [PASSWORD_METHOD];

/**
 * The instance's method-set policy, over one deployment's four answers. `resolvePolicy` is the port
 * the router routes on and the hook enforces from: one resolution per request, and both gate reads
 * inside it hit the same per-process memo.
 */
export class SignInMethodPolicyService implements SignInMethodPolicyPort {
  static create(inputs: SignInMethodPolicyInputs): SignInMethodPolicyService {
    return new SignInMethodPolicyService(inputs);
  }

  private constructor(private readonly inputs: SignInMethodPolicyInputs) {}

  /**
   * Whether this deployment mounted the passkey plugin at boot. The server
   * half is registered off the same value, so the set can never name a method
   * the endpoint behind it does not have.
   */
  static deploymentOffersPasskeys(passkeysEnabled: string | undefined): boolean {
    return passkeysEnabled === "on";
  }

  /**
   * Whether this deployment names a federated method AT ALL — a pure env read, synchronous on
   * purpose.
   * ADR-027's `isGateDependentPath` exists to avoid.
   */
  static deploymentIsFederationCapable(authProvider: string | undefined): boolean {
    return authProvider !== "email";
  }

  /** The federated method a deployment offers, or null for email mode. */
  static async resolveFederatedMethod(
    resolveAuthProvider: () => Promise<string>,
  ): Promise<SignInMethod | null> {
    const provider = await resolveAuthProvider();

    return provider === "email" ? null : { id: provider, kind: "federated", connectionId: null };
  }

  async resolvePolicy(): Promise<SignInMethodPolicy> {
    const federationLicensed = await this.inputs.federationLicensed();
    const federated = await SignInMethodPolicyService.resolveFederatedMethod(
      this.inputs.resolveAuthProvider,
    );
    // Offered alongside whatever else answers, never instead of it: somebody
    // without a passkey on THIS device must still find the way they used last
    // time. It is appended, so the order the screen renders does not move.
    const passkeys = this.inputs.offersPasskeys() ? [PASSKEY_METHOD] : [];

    return {
      defaultMethods: [...(federated ? [federated] : LOCAL_METHOD_SET), ...passkeys],
      localMethods: [...LOCAL_METHOD_SET, ...passkeys],
      federationLicensed,
      // Only a self-hosted deployment auto-redirects on its sole connection.
      selfHosted: this.inputs.selfHosted(),
    };
  }
}
