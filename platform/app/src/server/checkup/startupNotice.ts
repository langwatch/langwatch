/**
 * Whether the startup notice is due
 * (specs/self-hosting/checkup/startup-notice.feature).
 *
 * Due once per schema version of the usage report: a fresh install has
 * acknowledged nothing, and an upgrade that changes what the report carries
 * makes the notice due again. The decision reads the identity row and never
 * mints it, so opening the app gives no install an identity; the dismissal
 * does, because it has to be written somewhere that outlives the browser.
 */

import { USAGE_REPORT_SCHEMA_VERSION } from "~/server/usage-report/dictionary";

export interface StartupNoticeInput {
  readonly isSaas: boolean;
  readonly usageReportsDisabled: boolean;
  /** Null where the install has never minted an identity. */
  readonly acknowledgedSchemaVersion: number | null;
  readonly schemaVersion?: number;
}

export interface StartupNoticeState {
  readonly show: boolean;
  readonly schemaVersion: number;
}

export function startupNoticeState({
  isSaas,
  usageReportsDisabled,
  acknowledgedSchemaVersion,
  schemaVersion = USAGE_REPORT_SCHEMA_VERSION,
}: StartupNoticeInput): StartupNoticeState {
  if (isSaas || usageReportsDisabled) return { show: false, schemaVersion };
  return {
    show: (acknowledgedSchemaVersion ?? 0) < schemaVersion,
    schemaVersion,
  };
}
