// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * An activation code set as the configured license (`LANGWATCH_LICENSE_KEY`,
 * Helm `app.license.key`) is redeemed through the same call the License page
 * makes and stored on the oldest organization. Never throws: a refusal is
 * logged with its reason and the install runs without the license.
 * @see specs/licensing/configured-license-forms.feature
 */
import type { LicenseInputForm } from "@langwatch/enterprise-licensing-contract";

export type ConfiguredActivationOutcome =
  | { outcome: "not_configured" }
  | { outcome: "license_key" }
  | { outcome: "already_licensed"; organizationId: string }
  | { outcome: "no_organization" }
  | { outcome: "connect_disabled" }
  | { outcome: "activated"; organizationId: string }
  | { outcome: "refused"; code: string }
  | { outcome: "license_rejected"; error: string };

interface ConfiguredActivationLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface ConfiguredActivationDependencies {
  /** The configured value, already read for its form. */
  readonly configured: LicenseInputForm;
  /** Whether Connect is on (`LANGWATCH_CONNECT_DISABLED` unset). */
  readonly connectPermitted: boolean;
  /** Every organization with its stored license, oldest first. */
  findOrganizations(): Promise<{ organizationId: string; license: string | null }[]>;
  /** Redeems the code at the connect host; throws on refusal. */
  redeem(input: { code: string }): Promise<{ licenseKey: string }>;
  /** Validates and stores the license on the organization. */
  store(input: {
    organizationId: string;
    licenseKey: string;
  }): Promise<{ success: true } | { success: false; error: string }>;
  /** Whether a stored license is signed by LangWatch and inside its term. */
  isValidLicense(licenseKey: string): boolean;
  readonly logger: ConfiguredActivationLogger;
}

type LogContext = { source: string; form: "activation_code"; codeHint: string };

/** The code a refusal carries, or `connect_unreachable` when none came back. */
function refusalCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "connect_unreachable";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ConfiguredActivationService {
  static create(deps: ConfiguredActivationDependencies): ConfiguredActivationService {
    return new ConfiguredActivationService(deps);
  }

  private constructor(private readonly deps: ConfiguredActivationDependencies) {}

  async activate(): Promise<ConfiguredActivationOutcome> {
    const { configured, logger } = this.deps;
    if (configured.form === "empty") return { outcome: "not_configured" };
    if (configured.form === "license_key") {
      logger.info(
        { source: "LANGWATCH_LICENSE_KEY", form: "license_key" },
        "LANGWATCH_LICENSE_KEY holds a signed license key; it is used as is and needs no outbound access",
      );
      return { outcome: "license_key" };
    }
    try {
      return await this.redeem(configured.code);
    } catch (error) {
      logger.warn(
        { error },
        "Could not check the configured license; the app runs without redeeming it",
      );
      return { outcome: "not_configured" };
    }
  }

  private async findLicensed() {
    const organizations = await this.deps.findOrganizations();
    const licensed = organizations.find(
      (organization) => !!organization.license && this.deps.isValidLicense(organization.license),
    );
    return { organizations, licensed };
  }

  private async redeem(code: string): Promise<ConfiguredActivationOutcome> {
    const { logger } = this.deps;
    const context: LogContext = {
      source: "LANGWATCH_LICENSE_KEY",
      form: "activation_code",
      codeHint: code.slice(-4),
    };

    const { organizations, licensed } = await this.findLicensed();
    if (licensed) {
      logger.info(
        { ...context, organizationId: licensed.organizationId },
        "LANGWATCH_LICENSE_KEY holds an activation code; this install already holds a valid license, so the code is not redeemed again",
      );
      return { outcome: "already_licensed", organizationId: licensed.organizationId };
    }

    const target = organizations[0];
    if (!target) {
      logger.info(
        context,
        "LANGWATCH_LICENSE_KEY holds an activation code; there is no organization yet, so it is redeemed when the first organization is created",
      );
      return { outcome: "no_organization" };
    }

    if (!this.deps.connectPermitted) {
      logger.warn(
        context,
        "LANGWATCH_LICENSE_KEY holds an activation code, but LANGWATCH_CONNECT_DISABLED is set, so it cannot be redeemed; set LANGWATCH_LICENSE_KEY to the signed license key instead",
      );
      return { outcome: "connect_disabled" };
    }

    let licenseKey: string;
    try {
      ({ licenseKey } = await this.deps.redeem({ code }));
    } catch (error) {
      return this.explainRefusal({ context, error });
    }
    return this.storeRedeemed({ context, organizationId: target.organizationId, licenseKey });
  }

  private async explainRefusal({
    context,
    error,
  }: {
    context: LogContext;
    error: unknown;
  }): Promise<ConfiguredActivationOutcome> {
    const code = refusalCodeOf(error);
    // Two replicas booting together redeem the same code; the loser is told it
    // was already used, and by then the winner has stored the license.
    if (code === "activation_code_already_redeemed") {
      const { licensed } = await this.findLicensed();
      if (licensed) {
        this.deps.logger.info(
          { ...context, organizationId: licensed.organizationId },
          "LANGWATCH_LICENSE_KEY holds an activation code; another process of this install redeemed it and stored the license",
        );
        return { outcome: "already_licensed", organizationId: licensed.organizationId };
      }
    }
    this.deps.logger.warn(
      { ...context, code, reason: messageOf(error) },
      `LANGWATCH_LICENSE_KEY holds an activation code; redeeming it at connect.langwatch.ai failed (${code}), so the app starts without a license`,
    );
    return { outcome: "refused", code };
  }

  private async storeRedeemed({
    context,
    organizationId,
    licenseKey,
  }: {
    context: LogContext;
    organizationId: string;
    licenseKey: string;
  }): Promise<ConfiguredActivationOutcome> {
    const stored = await this.deps.store({ organizationId, licenseKey });
    if (!stored.success) {
      this.deps.logger.warn(
        { ...context, organizationId, error: stored.error },
        "LANGWATCH_LICENSE_KEY holds an activation code; the license it was exchanged for did not validate, so it was not stored",
      );
      return { outcome: "license_rejected", error: stored.error };
    }
    this.deps.logger.info(
      { ...context, organizationId },
      "LANGWATCH_LICENSE_KEY holds an activation code; redeemed it and stored the license on the organization",
    );
    return { outcome: "activated", organizationId };
  }
}
