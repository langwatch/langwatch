/**
 * Reading a usage report's untyped properties onto an install's row
 * (ADR-156, section 10). A report is whatever an install at any version sent,
 * so every field is narrowed rather than trusted.
 */

import type {
  SelfHostedInstanceActivity,
  SelfHostedReportProperties,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isReportText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isReportNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** What one report says about its install, each field null where it said nothing usable. */
export type ReportFields = Readonly<{
  version: string | null;
  installMethod: string | null;
  chartVersion: string | null;
  hostname: string | null;
  environment: string | null;
  installedAt: Instant | null;
  reportSchemaVersion: number | null;
  userEmailDomains: Record<string, number> | null;
  /** The domain most users are on, which is the one naming the company. */
  leadingDomain: string | null;
}>;

export function reportFieldsOf(properties: SelfHostedReportProperties): ReportFields {
  const text = (value: unknown) => (isReportText(value) ? value : null);
  const counts = domainCountsOf(properties.user_email_domains);
  const [leading] = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .toSorted((a, b) => b[1] - a[1]);
  return {
    version: text(properties.version),
    installMethod: text(properties.install_method),
    chartVersion: text(properties.chart_version),
    hostname: text(properties.hostname),
    environment: text(properties.environment),
    installedAt: instantsOf(properties.first_seen_at)[0] ?? null,
    reportSchemaVersion: isReportNumber(properties.report_schema_version)
      ? properties.report_schema_version
      : null,
    userEmailDomains: Object.keys(counts).length > 0 ? counts : null,
    leadingDomain: leading?.[0] ?? null,
  };
}

/** Domains with counts; empty on a report that carried none. */
function domainCountsOf(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => isReportNumber(entry[1])),
  );
}

/** The instant a field names, as a list of at most one: empty where it named none. */
function instantsOf(value: unknown): Instant[] {
  if (!isReportText(value)) return [];
  try {
    return [Temporal.Instant.from(value)];
  } catch {
    return [];
  }
}

/** Whether the report carries any optional-category key, read from what arrived. */
export function carriesOptionalCategory({
  properties,
  optionalKeys,
}: {
  properties: SelfHostedReportProperties;
  optionalKeys: ReadonlySet<string>;
}): boolean {
  return Object.keys(properties).some((key) => optionalKeys.has(key));
}

/** A report is daily: two days of silence is a gap, and a fortnight is an install turned off. */
export function instanceActivity({
  lastSeenAt,
  now,
}: {
  lastSeenAt: Instant;
  now: Instant;
}): SelfHostedInstanceActivity {
  const age = now.epochMilliseconds - lastSeenAt.epochMilliseconds;
  if (age <= 2 * DAY_MS) return "reporting";
  if (age <= 14 * DAY_MS) return "quiet";
  return "gone";
}
