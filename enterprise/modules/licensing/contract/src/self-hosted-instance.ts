import { HandledError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The registry of self-hosted installs as it leaves the feature (ADR-156,
 * section 10). Every instant is an ISO string.
 *
 * @see specs/self-hosting/connected-services/instance-registry.feature
 */
import { z } from "zod";

/** Every field the usage report receiver accepted, minus the instance id. */
export type SelfHostedReportProperties = Record<string, unknown>;

/** Reporting within two days, silent under a fortnight, or turned off. */
export const selfHostedInstanceActivitySchema = z.enum(["reporting", "quiet", "gone"]);
export type SelfHostedInstanceActivity = z.infer<typeof selfHostedInstanceActivitySchema>;

/** The handful of things an install can do that a person should hear about. */
export const SELF_HOSTED_SIGNALS = [
  "seats_crossed_threshold",
  "sustained_ingestion",
  "licensed_feature_without_license",
  "license_expiring",
  "domain_has_cloud_account",
  "license_sync_stale",
] as const;

export type SelfHostedSignal = (typeof SELF_HOSTED_SIGNALS)[number];

/** One install as the admin console reads it. */
const selfHostedInstanceViewSchemaDefinition = z.object({
  id: z.string(),
  instanceId: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  version: z.string().nullable(),
  installMethod: z.string().nullable(),
  chartVersion: z.string().nullable(),
  hostname: z.string().nullable(),
  environment: z.string().nullable(),
  installedAt: z.string().nullable(),
  reportSchemaVersion: z.number().nullable(),
  organizationId: z.string().nullable(),
  issuedLicenseId: z.string().nullable(),
  userEmailDomains: z.record(z.string(), z.number()).nullable(),
  latestReport: z.record(z.string(), z.unknown()).nullable(),
  optionalMetricsReported: z.boolean(),
  hostnameReported: z.boolean(),
  reportCount: z.number(),
  lastUnknownFields: z.number(),
  raisedSignals: z.array(z.string()),
  /** The customer's name, when the license bound this install to one. */
  organizationName: z.string().nullable(),
  activity: selfHostedInstanceActivitySchema,
});
export interface SelfHostedInstanceViewSchema extends Named<
  typeof selfHostedInstanceViewSchemaDefinition
> {}
export const selfHostedInstanceViewSchema: SelfHostedInstanceViewSchema =
  selfHostedInstanceViewSchemaDefinition;
export type SelfHostedInstanceView = z.infer<typeof selfHostedInstanceViewSchema>;

const selfHostedInstancePageSchemaDefinition = z.object({
  instances: z.array(selfHostedInstanceViewSchema),
  total: z.number(),
});
export interface SelfHostedInstancePageSchema extends Named<
  typeof selfHostedInstancePageSchemaDefinition
> {}
export const selfHostedInstancePageSchema: SelfHostedInstancePageSchema =
  selfHostedInstancePageSchemaDefinition;
export type SelfHostedInstancePage = z.infer<typeof selfHostedInstancePageSchema>;

/** The orders an operator picks; absent is most recent report first. */
export const selfHostedInstanceSortSchema = z.enum([
  "last_report",
  "newest",
  "traces_28d",
  "users",
  "active_users_28d",
]);
export type SelfHostedInstanceSort = z.infer<typeof selfHostedInstanceSortSchema>;

export const selfHostedLicenseFilterSchema = z.enum(["licensed", "open_source"]);

const selfHostedInstanceFiltersSchemaDefinition = z.object({
  sort: selfHostedInstanceSortSchema.optional(),
  license: selfHostedLicenseFilterSchema.optional(),
  activity: selfHostedInstanceActivitySchema.optional(),
  signal: z.enum(SELF_HOSTED_SIGNALS).optional(),
});
export type SelfHostedInstanceFilters = z.infer<typeof selfHostedInstanceFiltersSchemaDefinition>;

const listSelfHostedInstancesInputSchemaDefinition = z.object({
  ...selfHostedInstanceFiltersSchemaDefinition.shape,
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
});
export interface ListSelfHostedInstancesInputSchema extends Named<
  typeof listSelfHostedInstancesInputSchemaDefinition
> {}
export const listSelfHostedInstancesInputSchema: ListSelfHostedInstancesInputSchema =
  listSelfHostedInstancesInputSchemaDefinition;

const selfHostedInstanceIdInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface SelfHostedInstanceIdInputSchema extends Named<
  typeof selfHostedInstanceIdInputSchemaDefinition
> {}
export const selfHostedInstanceIdInputSchema: SelfHostedInstanceIdInputSchema =
  selfHostedInstanceIdInputSchemaDefinition;

/** One row of an install's report history. */
const selfHostedReportSummarySchemaDefinition = z.object({
  id: z.string(),
  receivedAt: z.string(),
  version: z.string().nullable(),
  unknownFields: z.number(),
});
export interface SelfHostedReportSummarySchema extends Named<
  typeof selfHostedReportSummarySchemaDefinition
> {}
export const selfHostedReportSummarySchema: SelfHostedReportSummarySchema =
  selfHostedReportSummarySchemaDefinition;
export type SelfHostedReportSummary = z.infer<typeof selfHostedReportSummarySchema>;

const selfHostedInstanceDetailSchemaDefinition = z.object({
  instance: selfHostedInstanceViewSchema,
  reports: z.array(selfHostedReportSummarySchema),
});
export interface SelfHostedInstanceDetailSchema extends Named<
  typeof selfHostedInstanceDetailSchemaDefinition
> {}
export const selfHostedInstanceDetailSchema: SelfHostedInstanceDetailSchema =
  selfHostedInstanceDetailSchemaDefinition;
export type SelfHostedInstanceDetail = z.infer<typeof selfHostedInstanceDetailSchema>;

/** What the registry adds up to: the top of the operator's page. */
const selfHostedInstanceSummarySchemaDefinition = z.object({
  total: z.number(),
  reporting: z.number(),
  quiet: z.number(),
  gone: z.number(),
  licensed: z.number(),
  newLast7Days: z.number(),
  newLast30Days: z.number(),
  /** Traces over 28 days, summed over the installs still reporting. */
  traces28d: z.number(),
  /** Oldest first; a week with no new install is a zero, never a gap. */
  newPerWeek: z.array(z.object({ weekStart: z.string(), count: z.number() })),
  signals: z.array(z.object({ signal: z.enum(SELF_HOSTED_SIGNALS), count: z.number() })),
  /** Open source installs still reporting, most traces over 28 days first. */
  busiestOpenSource: z.array(selfHostedInstanceViewSchema),
  /** Releases the installs that reported in the last fortnight run, most common first. */
  releases: z.array(z.object({ version: z.string(), count: z.number() })),
});
export interface SelfHostedInstanceSummarySchema extends Named<
  typeof selfHostedInstanceSummarySchemaDefinition
> {}
export const selfHostedInstanceSummarySchema: SelfHostedInstanceSummarySchema =
  selfHostedInstanceSummarySchemaDefinition;
export type SelfHostedInstanceSummary = z.infer<typeof selfHostedInstanceSummarySchema>;

/** One report, as the receiver hands it over. */
export interface IncomingUsageReport {
  instanceId: string;
  properties: SelfHostedReportProperties;
  unknownFields: number;
  /** ISO instant the receiver accepted it. */
  receivedAt: string;
}

/** The registry has never heard from an install with that id. */
export class SelfHostedInstanceNotFoundError extends HandledError {
  declare readonly code: "self_hosted_instance_not_found";

  constructor() {
    super("self_hosted_instance_not_found", "No self-hosted install with that id has reported", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "SelfHostedInstanceNotFoundError";
  }
}
