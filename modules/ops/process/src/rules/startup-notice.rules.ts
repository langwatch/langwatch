import type { StartupNoticeState } from "@langwatch/ops-contract";

/**
 * Whether the startup notice is due: once per schema version of the usage
 * report, never on LangWatch Cloud, never with reporting switched off.
 * Spec: specs/self-hosting/checkup/startup-notice.feature
 */
export function startupNoticeState({
  isSaas,
  usageReportsDisabled,
  acknowledgedSchemaVersion,
  schemaVersion,
}: {
  isSaas: boolean;
  usageReportsDisabled: boolean;
  /** Absent where the install has never minted an identity. */
  acknowledgedSchemaVersion: number | undefined;
  schemaVersion: number;
}): StartupNoticeState {
  if (isSaas || usageReportsDisabled) return { show: false, schemaVersion };
  return { show: (acknowledgedSchemaVersion ?? 0) < schemaVersion, schemaVersion };
}
