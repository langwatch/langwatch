import {
  DENIED_SSO_GATE_TTL_MS,
  type PlatformLicenseAccess,
} from "@langwatch/enterprise-licensing-contract";
import { toEpochMs, type Instant } from "@langwatch/time";

class SsoGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`platform SSO licence scan exceeded ${timeoutMs}ms; treating the store as unreachable`);
    this.name = "SsoGateTimeoutError";
  }
}

type PlatformSsoGateOptions = {
  /** Reads the store for a licence that permits the platform. */
  scan: () => Promise<PlatformLicenseAccess>;
  /** Told of a failed or timed-out scan; the request is denied meanwhile. */
  onScanFailure: (error: unknown) => void;
  now: () => Instant;
  timeoutMs: number;
};

/**
 * The platform single sign-on answer, kept for the process (ADR-027 v9). An allow is kept
 * (a testing licence's until it ends), a deny is read again after `DENIED_SSO_GATE_TTL_MS`
 * or an invalidation, and a failed scan is not kept.
 */
export class PlatformSsoGateService {
  static create(options: PlatformSsoGateOptions): PlatformSsoGateService {
    return new PlatformSsoGateService(options);
  }

  private gate: Promise<boolean> | undefined;
  /** When the memo resolved to a deny; an allow is kept for the process. */
  private deniedAt: number | undefined;
  private allowedForProcess = false;
  /** Epoch ms a testing licence's allow ends: its expiry, at most a minute on (ADR-180). */
  private allowedUntil: number | undefined;

  private constructor(private readonly options: PlatformSsoGateOptions) {}

  async isLicensed(): Promise<boolean> {
    if (this.memoLapsed()) this.invalidate();
    const gate = this.gate ?? this.startScan();
    try {
      return await this.withinTimeout(gate);
    } catch (error) {
      this.options.onScanFailure(error);
      return false;
    }
  }

  /** Forgets a deny so the next request reads the store; an allow is kept. */
  invalidate(): void {
    if (this.allowedForProcess) return;
    this.gate = undefined;
    this.deniedAt = undefined;
    this.allowedUntil = undefined;
  }

  /** A kept deny is read again after its TTL; a testing licence's allow ends at its time. */
  private memoLapsed(): boolean {
    const now = this.nowMs();
    const deniedAt = this.deniedAt;
    const allowedUntil = this.allowedUntil;
    return (
      (deniedAt !== undefined && now - deniedAt >= DENIED_SSO_GATE_TTL_MS) ||
      (allowedUntil !== undefined && now >= allowedUntil)
    );
  }

  /** Scans once and keeps the answer, unless an invalidation replaced the memo meanwhile. */
  private startScan(): Promise<boolean> {
    const pending: Promise<boolean> = this.options.scan().then(
      (access) => {
        if (this.gate === pending) {
          this.deniedAt = access.allowed ? undefined : this.nowMs();
          this.allowedUntil =
            access.allowedUntil === undefined ? undefined : toEpochMs(access.allowedUntil);
          this.allowedForProcess = access.allowed && access.allowedUntil === undefined;
        }
        return access.allowed;
      },
      (error: unknown) => {
        if (this.gate === pending) this.gate = undefined;
        throw error;
      },
    );
    this.gate = pending;
    return pending;
  }

  /** A stuck store denies this request in time; the scan in flight stays the memo. */
  private async withinTimeout(gate: Promise<boolean>): Promise<boolean> {
    const timeoutMs = this.options.timeoutMs;
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

  private nowMs(): number {
    return this.options.now().epochMilliseconds;
  }
}
