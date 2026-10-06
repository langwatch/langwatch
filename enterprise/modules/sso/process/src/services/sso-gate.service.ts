import {
  DENIED_SSO_GATE_TTL_MS,
  type LicensingApi,
  type PlatformLicenseInspection,
} from "@langwatch/enterprise-licensing-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";

/**
 * Where the gate says what it decided. An operator whose single sign-on is off
 * reads these lines to learn why, so the module supplies its own logger.
 */
export interface SsoGateLogger {
  info(context: object, message: string): void;
  warn(context: object, message: string): void;
}

export abstract class SsoProviderMountInspector {
  abstract isMounted(configuration: SsoConfiguration): boolean;
}

export interface SsoGateServiceOptions {
  configuration: SsoConfiguration;
  licensing: LicensingApi;
  logger: SsoGateLogger;
  providerMountInspector: SsoProviderMountInspector;
  evaluationTimeoutMs?: number | undefined;
  /** Epoch milliseconds; the deny TTL is measured on it. */
  now?: (() => number) | undefined;
}

class SsoGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `SSO gate evaluation exceeded ${timeoutMs}ms; treating the licensing store as unreachable`,
    );
    this.name = "SsoGateTimeoutError";
  }
}

/**
 * ADR-027's Enterprise SSO gate, as amended in v9: an allow is kept for the
 * process, a deny is read again after `DENIED_SSO_GATE_TTL_MS` or as soon as
 * this process stores a license, and a failed read is never kept.
 */
export class SsoGateService {
  private memoizedGate: Promise<boolean> | null = null;
  /** When the memo resolved to a deny, and the license revision it read. */
  private denied: { at: number; revision: number | null } | null = null;
  private allowedForProcess = false;
  private warnedEmailMode = false;

  private readonly configuration: SsoConfiguration;
  private readonly licensing: LicensingApi;
  private readonly logger: SsoGateLogger;
  private readonly providerMountInspector: SsoProviderMountInspector;
  private readonly evaluationTimeoutMs: number;
  private readonly now: () => number;

  private constructor({
    configuration,
    licensing,
    logger,
    providerMountInspector,
    evaluationTimeoutMs,
    now,
  }: {
    configuration: SsoConfiguration;
    licensing: LicensingApi;
    logger: SsoGateLogger;
    providerMountInspector: SsoProviderMountInspector;
    evaluationTimeoutMs: number;
    now: () => number;
  }) {
    this.now = now;
    this.configuration = configuration;
    this.licensing = licensing;
    this.logger = logger;
    this.providerMountInspector = providerMountInspector;
    this.evaluationTimeoutMs = evaluationTimeoutMs;
  }

  static create(options: SsoGateServiceOptions): SsoGateService {
    return new SsoGateService({
      configuration: options.configuration,
      licensing: options.licensing,
      logger: options.logger,
      providerMountInspector: options.providerMountInspector,
      evaluationTimeoutMs: options.evaluationTimeoutMs ?? 5_000,
      now: options.now ?? Date.now,
    });
  }

  async platformAllowed(): Promise<boolean> {
    if (this.configuration.isSaas) {
      return true;
    }

    if (this.denied && (await this.denyIsStale(this.denied))) this.forgetDeny();
    if (!this.memoizedGate) this.memoizedGate = this.startComputation();

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
    if (this.configuration.provider === "email") {
      return "email";
    }

    if (!(await this.platformAllowed())) {
      return "email";
    }

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

  /** Clears every decision for isolated tests and smoke tools. */
  resetMemoizedDecisionForTests(): void {
    this.forgetDeny();
    this.allowedForProcess = false;
    this.warnedEmailMode = false;
  }

  private forgetDeny(): void {
    if (this.allowedForProcess) return;
    this.memoizedGate = null;
    this.denied = null;
  }

  /** A deny is stale after the TTL, or once this process stored a license since. */
  private async denyIsStale(denied: { at: number; revision: number | null }): Promise<boolean> {
    if (this.now() - denied.at >= DENIED_SSO_GATE_TTL_MS) return true;
    if (denied.revision === null) return false;
    return (await this.readRevision()) !== denied.revision;
  }

  /** The revision is a shortcut; where licensing cannot answer it, the TTL alone applies. */
  private async readRevision(): Promise<number | null> {
    try {
      return await this.licensing.licenseRevision();
    } catch {
      return null;
    }
  }

  private startComputation(): Promise<boolean> {
    const pending: Promise<boolean> = this.readRevision()
      .then(async (revision) => {
        const allowed = await this.computeGate();
        // An invalidation while this read was in flight already replaced the memo.
        if (this.memoizedGate === pending) {
          this.denied = allowed ? null : { at: this.now(), revision };
          this.allowedForProcess = allowed;
        }
        if (!allowed) this.warnEmailModeOnce();
        return allowed;
      })
      .catch((error: unknown) => {
        if (this.memoizedGate === pending) this.memoizedGate = null;
        throw error;
      });
    return pending;
  }

  /** Once per process, not on every re-read (Decision 8a). */
  private warnEmailModeOnce(): void {
    if (this.warnedEmailMode || this.configuration.provider === "email") return;
    this.warnedEmailMode = true;
    this.logger.warn(
      {},
      "SSO is configured but no genuine license was found, so sign-in uses email mode; " +
        "set LANGWATCH_LICENSE_KEY or activate an organization license, and SSO turns on within a minute",
    );
  }

  private async computeGate(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.licensing.inspectPlatformAccess(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SsoGateTimeoutError(this.evaluationTimeoutMs)),
            this.evaluationTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
      for (const inspection of result.inspections) {
        this.logInspection(inspection);
      }

      return result.allowed;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private logInspection(inspection: PlatformLicenseInspection): void {
    const context = {
      source: inspection.source,
      organizationId: inspection.organizationId,
    };
    if (!inspection.valid) {
      const message =
        inspection.reason === "invalid_format"
          ? "Inspected a license candidate: could not be parsed (invalid format)"
          : "Inspected a license candidate: signature failed";
      this.logger.info({ ...context, signatureOk: false }, message);

      return;
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
  }
}
