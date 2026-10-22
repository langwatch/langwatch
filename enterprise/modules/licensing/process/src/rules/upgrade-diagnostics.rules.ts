// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Where Cloud keeps a received upgrade diagnostics bundle and how often one instance may send.
 * Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
 */

/** ADR-172: the kind prefix the 30-day lifecycle rule matches (charts/langwatch/values.yaml). */
export const UPGRADE_DIAGNOSTICS_PREFIX = "upgrade-diagnostics";

/** The platform tenant: object storage places it on the shared backend, never a customer's. */
export const UPGRADE_DIAGNOSTICS_TENANT = "platform";

/** Per instance, per day: a failing step sends at most hourly, an operator by hand. */
export const UPGRADE_DIAGNOSTICS_LIMIT = { requests: 30, seconds: 24 * 60 * 60 } as const;

/** How long a Cloud admin download link lives. */
export const UPGRADE_DIAGNOSTICS_DOWNLOAD_MINUTES = 5;

export function upgradeDiagnosticsObjectKey({
  instanceId,
  reportId,
}: {
  instanceId: string;
  reportId: string;
}): string {
  return `${UPGRADE_DIAGNOSTICS_PREFIX}/${encodeURIComponent(instanceId)}/${reportId}.json`;
}

export function upgradeDiagnosticsRateLimitKey(instanceId: string): string {
  return `upgrade_diagnostics:${instanceId}`;
}
