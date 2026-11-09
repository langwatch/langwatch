/**
 * The retention choice in the upgrade dialog: what each option costs on top of Growth.
 * @see specs/billing/retention-at-upgrade.feature
 */
import {
  estimateBytesAboveIncludedRetention,
  GROWTH_INCLUDED_RETENTION_DAYS,
  GROWTH_RETENTION_OPTIONS,
  type OrganizationStorageEstimate,
} from "@langwatch/data-retention-contract";

import { type Currency, formatPrice, retentionStorageCentsPerGb } from "./billing-plans.ts";

export { GROWTH_INCLUDED_RETENTION_DAYS, GROWTH_RETENTION_OPTIONS };

const BYTES_PER_GB = 1_000_000_000;

/** Where the organization's storage read is while the dialog is open. */
export type RetentionEstimateState =
  | { status: "loading" }
  | { status: "ready"; estimate: OrganizationStorageEstimate }
  | { status: "failed" };

/** The storage line under the retention picker. */
export type RetentionStorageLine =
  | { kind: "included" }
  | { kind: "loading"; unitPrice: string }
  | { kind: "estimate"; unitPrice: string; amount: string }
  | { kind: "unitOnly"; unitPrice: string };

function formatGb(gb: number): string {
  if (gb < 1) return "Less than 1 GB";
  return `About ${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(gb)} GB`;
}

export function retentionStorageLine({
  retentionDays,
  currency,
  estimate,
}: {
  retentionDays: number;
  currency: Currency;
  estimate: RetentionEstimateState;
}): RetentionStorageLine {
  if (retentionDays <= GROWTH_INCLUDED_RETENTION_DAYS) return { kind: "included" };
  const centsPerGb = retentionStorageCentsPerGb(currency);
  const unitPrice = `${formatPrice({ cents: centsPerGb, currency })} per GB a month`;
  if (estimate.status === "loading") return { kind: "loading", unitPrice };
  if (estimate.status === "failed") return { kind: "unitOnly", unitPrice };

  const gb =
    estimateBytesAboveIncludedRetention({ ...estimate.estimate, retentionDays }) / BYTES_PER_GB;
  const cents = Math.ceil(gb) * centsPerGb;
  return {
    kind: "estimate",
    unitPrice,
    amount: `${formatGb(gb)}, about ${formatPrice({ cents, currency })} a month`,
  };
}
