// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SsoGate,
  type SsoConfiguration,
} from "@langwatch/enterprise-sso-contract";

export interface OrgLicenseCandidate {
  id: string;
  license: string;
}

export abstract class SsoLicenseRepository {
  abstract findOrganizationsWithLicense(): Promise<OrgLicenseCandidate[]>;
}

export type SsoLicenseInspection =
  | { valid: false; reason: "invalid_format" | "invalid_signature" }
  | {
      valid: true;
      expiresAt: string;
      organizationName: string;
      expired: boolean;
    };

export abstract class SsoLicenseVerifier {
  abstract inspect(licenseKey: string): SsoLicenseInspection;
}

export abstract class SsoGateLogger {
  abstract info(context: object, message: string): void;
  abstract warn(context: object, message: string): void;
}

export abstract class SsoProviderMountInspector {
  abstract isMounted(configuration: SsoConfiguration): boolean;
}

export interface SsoGateServiceOptions {
  configuration: SsoConfiguration;
  repository: SsoLicenseRepository;
  verifier: SsoLicenseVerifier;
  logger: SsoGateLogger;
  providerMountInspector: SsoProviderMountInspector;
  evaluationTimeoutMs?: number | undefined;
}

class SsoGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `SSO gate evaluation exceeded ${timeoutMs}ms; treating the licensing store as unreachable`,
    );
    this.name = "SsoGateTimeoutError";
  }
}

/** ADR-027's process-frozen, failure-evicting Enterprise SSO gate. */
export class SsoGateService extends SsoGate {
  private memoizedGate: Promise<boolean> | null = null;

  private constructor(
    private readonly configuration: SsoConfiguration,
    private readonly repository: SsoLicenseRepository,
    private readonly verifier: SsoLicenseVerifier,
    private readonly logger: SsoGateLogger,
    private readonly providerMountInspector: SsoProviderMountInspector,
    private readonly evaluationTimeoutMs: number,
  ) {
    super();
  }

  static create(options: SsoGateServiceOptions): SsoGateService {
    return new SsoGateService(
      options.configuration,
      options.repository,
      options.verifier,
      options.logger,
      options.providerMountInspector,
      options.evaluationTimeoutMs ?? 5_000,
    );
  }

  async platformAllowed(): Promise<boolean> {
    if (this.configuration.isSaas) return true;

    if (!this.memoizedGate) {
      this.memoizedGate = this.computeGate()
        .then((allowed) => {
          if (!allowed && this.configuration.provider !== "email") {
            this.logger.warn(
              {},
              "SSO is configured but no genuine license was found — starting in email mode; " +
                "set LANGWATCH_LICENSE_KEY or activate an organization license to enable SSO",
            );
          }
          return allowed;
        })
        .catch((error: unknown) => {
          this.memoizedGate = null;
          throw error;
        });
    }

    try {
      return await this.memoizedGate;
    } catch (error) {
      this.logger.warn(
        { error },
        "SSO gate evaluation failed (licensing store unreachable) — denying SSO for this request; will retry on the next request",
      );
      return false;
    }
  }

  providerIsMounted(): boolean {
    return this.providerMountInspector.isMounted(this.configuration);
  }

  async resolveProvider(): Promise<string> {
    if (this.configuration.provider === "email") return "email";
    if (!(await this.platformAllowed())) return "email";

    if (!this.providerIsMounted()) {
      this.logger.warn(
        { provider: this.configuration.provider },
        "NEXTAUTH_PROVIDER names a provider this deployment cannot mount — " +
          "starting in email mode; check the provider id against the " +
          "self-hosting SSO docs and that its client credentials are set",
      );
      return "email";
    }

    return this.configuration.provider;
  }

  /** Clears the process-frozen decision for isolated tests and smoke tools. */
  resetMemoizedDecisionForTests(): void {
    this.memoizedGate = null;
  }

  private async computeGate(): Promise<boolean> {
    if (
      this.hasSignedLicense(this.configuration.instanceLicenseKey, {
        source: "instance",
      })
    ) {
      return true;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.anyOrganizationHasSignedLicense(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SsoGateTimeoutError(this.evaluationTimeoutMs)),
            this.evaluationTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async anyOrganizationHasSignedLicense(): Promise<boolean> {
    const candidates = await this.repository.findOrganizationsWithLicense();
    for (const candidate of candidates) {
      if (
        this.hasSignedLicense(candidate.license, {
          source: "organization",
          organizationId: candidate.id,
        })
      ) {
        return true;
      }
    }
    return false;
  }

  private hasSignedLicense(
    licenseKey: string | undefined,
    context: { source: "instance" | "organization"; organizationId?: string },
  ): boolean {
    if (!licenseKey) return false;
    const inspection = this.verifier.inspect(licenseKey);
    if (!inspection.valid) {
      const message =
        inspection.reason === "invalid_format"
          ? "Inspected a license candidate: could not be parsed (invalid format)"
          : "Inspected a license candidate: signature failed";
      this.logger.info({ ...context, signatureOk: false }, message);
      return false;
    }

    this.logger.info(
      { ...context, signatureOk: true },
      "Inspected a license candidate: signature ok",
    );
    if (inspection.expired) {
      this.logger.warn(
        {
          ...context,
          organizationName: inspection.organizationName,
          expiresAt: inspection.expiresAt,
        },
        "SSO granted by an expired (but signature-valid) license — renewal reminder",
      );
    }
    return true;
  }
}
