/**
 * Which retention an organization's storage is billed by.
 * Spec: specs/billing/retention-storage-billing.feature
 */
import { GROWTH_INCLUDED_RETENTION_DAYS } from "@langwatch/data-retention-contract";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The longest retention any of the organization's rules keeps, 0 when one keeps data forever.
 * An organization without rules keeps no more than Growth includes.
 */
export function longestRetentionDays(rules: readonly { retentionDays: number }[]): number {
  if (rules.length === 0) return GROWTH_INCLUDED_RETENTION_DAYS;
  if (rules.some((rule) => rule.retentionDays === 0)) return 0;
  return Math.max(...rules.map((rule) => rule.retentionDays));
}

/** Rows written before this instant are past what Growth includes, so they are billed. */
export function includedRetentionCutoffMs(nowMs: number): number {
  return nowMs - GROWTH_INCLUDED_RETENTION_DAYS * DAY_MS;
}
