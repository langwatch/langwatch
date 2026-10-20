// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Where Cloud keeps a received upgrade diagnostics bundle, how often one instance may send, and
 * the link a Slack message carries. Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
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

/** Cloud admin's self-hosted instances page, its drawer open on one row where it is known. */
export function selfHostedInstanceAdminUrl({
  baseUrl,
  instanceRowId,
}: {
  baseUrl: string;
  instanceRowId: string | null;
}): string {
  const page = `${baseUrl.replace(/\/+$/, "")}/ops/cloud/self-hosted-instances`;
  return instanceRowId ? `${page}?instance=${encodeURIComponent(instanceRowId)}` : page;
}

/** Each step and release announces once; a later attempt of it is listed in Cloud admin only. */
export function announcementKeyOf(report: {
  instanceId: string;
  stepId: string;
  release: string | null;
}): string {
  return `${report.instanceId}\u0000${report.stepId}\u0000${report.release ?? ""}`;
}
