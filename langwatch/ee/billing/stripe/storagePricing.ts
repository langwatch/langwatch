/**
 * ADR-027 storage billing — the price contract, as code.
 *
 * The `STORAGE_GB` Stripe meter sums additive hourly MiB values (MiB-hours) over
 * the period; a single static `unit_amount_decimal` applied to that sum yields
 * the bill. This module is the single source of truth for that unit price and
 * the headline it derives from, so the (externally-created) Stripe Price's
 * `unit_amount_decimal` can be pinned against it and never drift silently.
 *
 * Unit vocabulary is BINARY and deliberate (see the ADR): quantities are MiB
 * (`bytes / 1_048_576`), prices per GiB (1024 MiB). The `STORAGE_GB` / `megabytes`
 * labels are opaque — renaming Stripe meters later is painful, so the binary
 * reality is documented, not renamed. We bill the LOGICAL (uncompressed
 * `_size_bytes`) volume, not the compressed on-disk footprint — that is the
 * priced unit and the contract.
 */

/** Headline price: €3 per logical GiB-month, 30-day-month convention. */
export const STORAGE_EUR_PER_GIB_MONTH = 3;

/** 30-day-month convention (AWS S3 / R2 style): 1 GiB held bills €3.10 in a
 *  31-day month, €2.80 in February. */
export const STORAGE_BILLING_DAYS_PER_MONTH = 30;
export const STORAGE_HOURS_PER_DAY = 24;
/** Binary GiB: 1 GiB = 1024 MiB. */
export const MIB_PER_GIB = 1024;

/**
 * Price in EUR per MiB-hour = headline / (days × hours × MiB-per-GiB).
 * ≈ €0.0000040690 per MiB-hour = €0.10 per GiB-day.
 */
export const STORAGE_EUR_PER_MIB_HOUR =
  STORAGE_EUR_PER_GIB_MONTH /
  (STORAGE_BILLING_DAYS_PER_MONTH * STORAGE_HOURS_PER_DAY * MIB_PER_GIB);

/**
 * Stripe `unit_amount_decimal` is the price in the currency's MINOR unit (cents
 * for EUR), as a decimal string. This is the value the `STORAGE_GB` metered
 * Price must carry; the pin test asserts it so a catalog edit can't drift it.
 * ≈ 0.00040690 cents per MiB-hour.
 */
export const STORAGE_UNIT_AMOUNT_DECIMAL_CENTS_PER_MIB_HOUR =
  STORAGE_EUR_PER_MIB_HOUR * 100;

/** Headline derived back from the unit price, for documentation/checks. */
export const STORAGE_EUR_PER_GIB_DAY =
  STORAGE_EUR_PER_MIB_HOUR * STORAGE_HOURS_PER_DAY * MIB_PER_GIB;

/**
 * Stripe meter event name — MUST match what {@link ReportStorageForHourCommand}
 * sends (Phase 3). The meter routes events by `event_name`, so a mismatch means
 * silently-unbilled usage.
 */
export const STORAGE_METER_EVENT_NAME = "langwatch_storage_megabytes_hourly";

/** Stripe meter default aggregation — additive sum of the hourly MiB values. */
export const STORAGE_METER_AGGREGATION = "sum" as const;
