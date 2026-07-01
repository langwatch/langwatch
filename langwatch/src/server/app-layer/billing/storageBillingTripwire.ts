import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:billing:storageTripwire");

/** Default relative tolerance before a divergence is logged. */
const DEFAULT_TOLERANCE_RATIO = 0.5;
/** Default cap on warnings per process, so a broken reference can't flood logs. */
const DEFAULT_MAX_LOGS = 50;

export interface StorageBillingTripwireDeps {
  /** Gate — the `release_storage_billing_metering_tripwire` flag, per org. */
  isEnabled: (organizationId: string) => Promise<boolean>;
  /**
   * An INDEPENDENT reference for the same hour's billable bytes, or null when
   * none is available (e.g. the first hour). Kept pluggable so the cheap
   * hour-over-hour anomaly reference can later be swapped for the precise
   * "reference SUM" once it's verified against real ClickHouse.
   */
  computeReference: (params: {
    organizationId: string;
    sealedHour: Date;
  }) => Promise<number | null>;
  /** Relative divergence (|measured − ref| / max) above which to warn. */
  toleranceRatio?: number;
  maxLogs?: number;
}

/**
 * ADR-027 measure-time tripwire (Phase 4.5). Shadow-compares each billed
 * measurement against an independent reference and logs a capped warning on
 * divergence beyond tolerance — the earlier, stronger form of the deferred
 * month-end reconciliation, catching a bad value *before* it bills.
 *
 * CONTRACT: `check` must NEVER throw into the measure/report path and never
 * alter the billed value. Every failure — flag lookup, reference computation,
 * comparison — is swallowed. It is purely observational.
 */
export class StorageBillingTripwire {
  private logs = 0;

  constructor(private readonly deps: StorageBillingTripwireDeps) {}

  async check(params: {
    organizationId: string;
    sealedHour: Date;
    measuredBytes: number;
  }): Promise<void> {
    try {
      if (!(await this.deps.isEnabled(params.organizationId))) return;

      const reference = await this.deps.computeReference({
        organizationId: params.organizationId,
        sealedHour: params.sealedHour,
      });
      if (reference == null) return;

      const diff = Math.abs(params.measuredBytes - reference);
      const scale = Math.max(params.measuredBytes, reference, 1);
      const ratio = diff / scale;
      const tolerance = this.deps.toleranceRatio ?? DEFAULT_TOLERANCE_RATIO;

      if (
        ratio > tolerance &&
        this.logs < (this.deps.maxLogs ?? DEFAULT_MAX_LOGS)
      ) {
        this.logs++;
        logger.warn(
          {
            organizationId: params.organizationId,
            sealedHour: params.sealedHour.toISOString(),
            measuredBytes: params.measuredBytes,
            reference,
            ratio,
            tolerance,
          },
          "TRIPWIRE: storage measurement diverges from reference beyond tolerance " +
            "— investigate before trusting the billed value.",
        );
      }
    } catch (error) {
      // Never break the measure path; the tripwire is purely observational.
      logger.debug(
        { organizationId: params.organizationId, error },
        "storage tripwire check failed (ignored)",
      );
    }
  }
}
