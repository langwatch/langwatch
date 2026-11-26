/**
 * The application version a trace ran on, which the Release check marks releases from.
 * @see specs/lwql/release-check-reads-releases.feature
 */

/** The replay step that refolds trace_analytics rows so they carry AppVersion (goose 00135). */
export const APP_VERSION_REPLAY_STEP_ID = "trace:replay-trace-analytics-app-version";

/** Where an application puts its version, first non-empty wins. */
const APP_VERSION_KEYS = ["service.version", "metadata.version", "metadata.app_version"] as const;

/** The `trace_analytics.AppVersion` value from the row's trimmed attribute map; '' when none. */
export function traceAnalyticsAppVersion(
  trimmedAttributes: Readonly<Record<string, string>>,
): string {
  return APP_VERSION_KEYS.map((key) => trimmedAttributes[key] ?? "").find(Boolean) ?? "";
}
