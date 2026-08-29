/**
 * The licensing feature's application: what both of its doors call.
 *
 * It holds every service and port the feature's api files reach, and it is the
 * one typed thing a transport is given. Before it, `license.*` and
 * `licenseEnforcement.*` each declared a private bag of process ports and took
 * it as an argument of its own — two descriptions of one deployment's
 * licensing capabilities, agreeing by attention rather than by construction,
 * and neither reachable from the other. A limit check and the license that
 * sets the limit are the same subject; they had no way to say so.
 *
 * What lives here as a method is what a door would otherwise decide for
 * itself: why a deployment configured for single sign-on is not using it,
 * whether an uploaded key is acceptable, what a minted key contains, and what
 * "every limit" means. The doors keep their own wording for a refusal, because
 * an error's copy and its status belong to the transport that answers.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  buildMintedPlan,
  getPlanTemplate,
  licenseValidationError,
  limitTypes,
  type LicenseData,
  type LimitCheckResult,
  type LimitType,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseCryptographyPort } from "../ports/license-cryptography.port";
import type { LicenseService } from "../services/license.service";

/**
 * The caller, as the enforcement service classifies them: a lite member is
 * counted differently from a full one, so an id alone cannot answer a limit.
 */
export type LicensingCaller = Readonly<{ id: string; email?: string | null }>;

/** Why a deployment configured for single sign-on is not using it. */
export type SsoGateStatus = Readonly<{
  configuredProvider: string | null;
  licensed: boolean;
  mounted: boolean;
}>;

/** Everything a minted key encodes beyond the organization it is minted for. */
export type MintLicenseInput = Readonly<{
  organizationId: string;
  privateKey: string;
  organizationName: string;
  email: string;
  expiresAt: Date;
  planType: "PRO" | "ENTERPRISE" | "CUSTOM";
  plan: Readonly<{
    maxMembers: number;
    maxMembersLite: number;
    maxMessagesPerMonth: number;
    canPublish: boolean;
    webhookEndpointsEnabled?: boolean | undefined;
    usageUnit: "traces" | "events";
  }>;
}>;

/** What the process composes this feature's application from. */
export interface LicensingAppDependencies {
  /** The process-composed license service. */
  licenses(): LicenseService;
  /** The process-composed signing and encoding adapter. */
  cryptography(): LicenseCryptographyPort;
  /**
   * The provider name the deployment is CONFIGURED with, before the license
   * gate and the mount inspector have their say. `null` or `"email"` means
   * nobody asked for federation.
   */
  configuredAuthProvider(): string | null | undefined;
  /** Whether the license permits platform single sign-on. */
  platformSsoAllowed(): Promise<boolean>;
  /** Whether the configured provider actually mounted. */
  authProviderIsMounted(): boolean;
  /** Records a signing failure; the customer never sees the diagnostic. */
  reportSigningFailure(entry: Readonly<{ organizationId: string; error: unknown }>): void;
  /** Whether one limit still admits another resource, for this caller. */
  checkLimit(
    input: Readonly<{
      organizationId: string;
      limitType: LimitType;
      user: LicensingCaller;
    }>,
  ): Promise<LimitCheckResult>;
  /** Swallows a notification failure into the process's error channel. */
  reportError(error: unknown): void;
}

export class LicensingApp {
  static create(dependencies: LicensingAppDependencies): LicensingApp {
    return new LicensingApp(dependencies);
  }

  private constructor(private readonly dependencies: LicensingAppDependencies) {}

  /** The license an organization is running on, its plan and its usage. */
  getLicenseStatus(organizationId: string) {
    return this.dependencies.licenses().getLicenseStatus(organizationId);
  }

  /**
   * Why a deployment configured for single sign-on is not using it.
   *
   * Here rather than in the door because the shape of the answer IS the rule:
   * a deployment that never asked for federation is neither unlicensed nor
   * unmounted, and reporting it as `licensed: true, mounted: true` is what
   * stops a settings page telling an operator to fix something that is not
   * broken. A second door asking the same question must get the same answer.
   */
  async getSsoGateStatus(): Promise<SsoGateStatus> {
    const configuredProvider = this.dependencies.configuredAuthProvider();
    if (!configuredProvider || configuredProvider === "email") {
      return { configuredProvider: null, licensed: true, mounted: true };
    }

    return {
      configuredProvider,
      licensed: await this.dependencies.platformSsoAllowed(),
      mounted: this.dependencies.authProviderIsMounted(),
    };
  }

  /**
   * Validates a pasted key and stores it, answering the plan it grants.
   *
   * The refusal is here rather than in the door because the service reports
   * its verdict as a `LICENSE_ERRORS` literal — a server discriminant, not
   * copy — and turning that into the code the presentation registry writes
   * against is a decision about the domain, not about the transport.
   */
  async uploadLicense(input: Readonly<{ organizationId: string; licenseKey: string }>) {
    const result = await this.dependencies
      .licenses()
      .validateAndStoreLicense(input.organizationId, input.licenseKey);

    if (!result.success) throw licenseValidationError(result.error);

    return result.planInfo;
  }

  /** Drops the key, returning the organization to the free tier. */
  removeLicense(organizationId: string) {
    return this.dependencies.licenses().removeLicense(organizationId);
  }

  /**
   * Mints and signs a key from a private key the operator pasted in.
   *
   * Everything a key contains is decided here: which template the plan type
   * resolves to, what the minted plan carries, and when the key was issued. A
   * door that assembled it would be a second definition of what a LangWatch
   * license IS.
   *
   * A signing failure is reported and rethrown rather than translated, because
   * the copy an operator reads for a bad private key belongs to the door that
   * answers them.
   */
  mintLicenseKey(input: MintLicenseInput): string {
    const template = getPlanTemplate(input.planType);
    const cryptography = this.dependencies.cryptography();

    const licenseData: LicenseData = {
      licenseId: cryptography.generateLicenseId(),
      version: 1,
      organizationName: input.organizationName,
      email: input.email,
      issuedAt: new Date().toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      plan: buildMintedPlan({
        type: template?.type ?? input.planType,
        name: template?.name ?? input.planType,
        maxMembers: input.plan.maxMembers,
        maxMembersLite: input.plan.maxMembersLite,
        maxMessagesPerMonth: input.plan.maxMessagesPerMonth,
        canPublish: input.plan.canPublish,
        webhookEndpointsEnabled: input.plan.webhookEndpointsEnabled,
        usageUnit: input.plan.usageUnit,
      }),
    };

    try {
      return cryptography.encodeLicenseKey(cryptography.signLicense(licenseData, input.privateKey));
    } catch (error) {
      this.dependencies.reportSigningFailure({ organizationId: input.organizationId, error });
      throw error;
    }
  }

  /** Whether one limit still admits another resource, for this caller. */
  checkLimit(
    input: Readonly<{ organizationId: string; limitType: LimitType; user: LicensingCaller }>,
  ): Promise<LimitCheckResult> {
    return this.dependencies.checkLimit(input);
  }

  /**
   * Every enforced limit at once, keyed by limit type.
   *
   * Which limits "every limit" means is the plan's business, not a door's: a
   * screen that enumerated them itself would go stale the day a limit is
   * added, and silently show one fewer.
   */
  async checkAllLimits(
    input: Readonly<{ organizationId: string; user: LicensingCaller }>,
  ): Promise<Record<LimitType, LimitCheckResult>> {
    const results = await Promise.all(
      limitTypes.map((limitType) =>
        this.dependencies.checkLimit({
          organizationId: input.organizationId,
          limitType,
          user: input.user,
        }),
      ),
    );
    return Object.fromEntries(results.map((result) => [result.limitType, result])) as Record<
      LimitType,
      LimitCheckResult
    >;
  }

  /** Swallows a notification failure into the process's error channel. */
  reportError(error: unknown): void {
    this.dependencies.reportError(error);
  }
}
