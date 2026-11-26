import { createHash } from "node:crypto";

import { isUpgradeInProgress } from "@langwatch/api";
import type { LicenseCryptography } from "@langwatch/enterprise-license-signing";
import {
  DENIED_SSO_GATE_TTL_MS,
  type PlatformLicenseAccess,
  type PlatformLicenseInspection,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import type { OrganizationLicenseRepository } from "../repositories/organization-license.repository.ts";

class SsoGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`platform SSO licence scan exceeded ${timeoutMs}ms; treating the store as unreachable`);
    this.name = "SsoGateTimeoutError";
  }
}

export type PlatformSsoGateOptions = {
  licenses: Pick<OrganizationLicenseRepository, "findOrganizationsWithLicense">;
  cryptography: LicenseCryptography;
  instanceLicenseKey: string | undefined;
  logger: { error(fields: Record<string, unknown>, message: string): void };
  now: () => Instant;
  timeoutMs: number;
};

/** Whether any signed license on this deployment permits platform single sign-on, memoised. */
export class PlatformSsoGateService {
  static create(options: PlatformSsoGateOptions): PlatformSsoGateService {
    return new PlatformSsoGateService(options);
  }

  private gate: Promise<boolean> | undefined;
  /** When the memo resolved to a deny; an allow is kept for the process. */
  private deniedAt: number | undefined;
  private allowedForProcess = false;

  private constructor(private readonly options: PlatformSsoGateOptions) {}

  async inspectPlatformAccess(): Promise<PlatformLicenseAccess> {
    return (await this.scanPlatformLicenses()).access;
  }

  /** `sha256:` of the licence key that permits the platform, empty where none does: the
   *  evidence a licence-proved domain records, so the key itself never leaves licensing. */
  async findPlatformLicenseDigests(): Promise<string[]> {
    const { permitting } = await this.scanPlatformLicenses();
    if (permitting === undefined) return [];
    return [`sha256:${createHash("sha256").update(permitting).digest("hex")}`];
  }

  /** The instance key first, then every stored one, until one permits the platform. */
  private async scanPlatformLicenses(): Promise<{
    access: PlatformLicenseAccess;
    permitting?: string;
  }> {
    const inspections: PlatformLicenseInspection[] = [];
    const permits = (
      licenseKey: string,
      source: Pick<PlatformLicenseInspection, "source" | "organizationId">,
    ): boolean => {
      const inspection = this.inspectPlatformLicense(licenseKey, source);
      inspections.push(inspection);
      return inspection.valid;
    };
    const { instanceLicenseKey } = this.options;
    if (instanceLicenseKey && permits(instanceLicenseKey, { source: "instance" })) {
      return { access: { allowed: true, inspections }, permitting: instanceLicenseKey };
    }

    const candidates = await this.options.licenses.findOrganizationsWithLicense();
    for (const candidate of candidates) {
      const source = { source: "organization" as const, organizationId: candidate.organizationId };
      if (permits(candidate.licenseKey, source)) {
        return { access: { allowed: true, inspections }, permitting: candidate.licenseKey };
      }
    }

    return { access: { allowed: false, inspections } };
  }

  /**
   * Whether a signed license anywhere on this deployment permits platform single
   * sign-on (ADR-027 v9). An allow is kept for the process, a deny is read again
   * after `DENIED_SSO_GATE_TTL_MS` or a store here, and a failed scan is not kept.
   */
  async isPlatformSsoLicensed({ isSaas }: { isSaas: boolean }): Promise<boolean> {
    if (isSaas) return true;
    const deniedAt = this.deniedAt;
    if (deniedAt !== undefined && this.nowMs() - deniedAt >= DENIED_SSO_GATE_TTL_MS) {
      this.invalidate();
    }
    if (!this.gate) {
      const pending: Promise<boolean> = this.inspectPlatformAccess().then(
        (access) => {
          // An invalidation while this scan was in flight already replaced the memo.
          if (this.gate === pending) {
            this.deniedAt = access.allowed ? undefined : this.nowMs();
            this.allowedForProcess = access.allowed;
          }
          return access.allowed;
        },
        (error: unknown) => {
          if (this.gate === pending) this.gate = undefined;
          throw error;
        },
      );
      this.gate = pending;
    }
    try {
      return await this.withinTimeout(this.gate);
    } catch (error) {
      logScanFailure({ logger: this.options.logger, error });
      return false;
    }
  }

  /** A stuck store denies this request in time; the scan in flight stays the memo. */
  private async withinTimeout(gate: Promise<boolean>): Promise<boolean> {
    const { timeoutMs } = this.options;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new SsoGateTimeoutError(timeoutMs)), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Forgets a deny so the next request reads the store; an allow is kept. */
  invalidate(): void {
    if (this.allowedForProcess) return;
    this.gate = undefined;
    this.deniedAt = undefined;
  }

  private nowMs(): number {
    return this.options.now().epochMilliseconds;
  }

  private inspectPlatformLicense(
    licenseKey: string,
    source: Pick<PlatformLicenseInspection, "source" | "organizationId">,
  ): PlatformLicenseInspection {
    const { cryptography } = this.options;
    const signedLicense = cryptography.parseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { ...source, valid: false, reason: "invalid_format" };
    }

    if (!cryptography.verifySignature(signedLicense)) {
      return { ...source, valid: false, reason: "invalid_signature" };
    }

    // A stored key that names another organization is not this organization's
    // entitlement, however genuine the signature is.
    const claimed = signedLicense.data.organizationId;
    if (
      claimed !== void 0 &&
      source.organizationId !== void 0 &&
      claimed !== source.organizationId
    ) {
      return { ...source, valid: false, reason: "organization_mismatch" };
    }

    return {
      ...source,
      valid: true,
      expiresAt: signedLicense.data.expiresAt,
      organizationName: signedLicense.data.organizationName,
      expired: cryptography.isExpired(signedLicense.data.expiresAt),
    };
  }
}

/** Before the worker creates the license table (install, upgrade) a failed scan is expected. */
function logScanFailure({
  logger,
  error,
}: {
  logger: PlatformSsoGateOptions["logger"];
  error: unknown;
}): void {
  if (isUpgradeInProgress(error)) return;
  logger.error({ error }, "the platform single sign-on license scan failed; denying for now");
}
