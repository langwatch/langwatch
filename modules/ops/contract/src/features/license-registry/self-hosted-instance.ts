/** The registry of self-hosted installs (ADR-156, section 10), as the
 * admin console reads it. `licensing` is enterprise, so every shape here is
 * declared locally rather than imported from it (as `license-registry.ts`). */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

const selfHostedInstanceActivitySchema = z.enum(["reporting", "quiet", "gone"]);

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

const selfHostedSignalSchema = z.enum([
  "seats_crossed_threshold",
  "sustained_ingestion",
  "licensed_feature_without_license",
  "license_expiring",
  "domain_has_cloud_account",
  "license_sync_stale",
]);
export type SelfHostedSignal = z.infer<typeof selfHostedSignalSchema>;

const selfHostedInstanceSortSchema = z.enum([
  "last_report",
  "newest",
  "traces_28d",
  "users",
  "active_users_28d",
]);
export type SelfHostedInstanceSort = z.infer<typeof selfHostedInstanceSortSchema>;
export type SelfHostedInstanceActivity = z.infer<typeof selfHostedInstanceActivitySchema>;

const listSelfHostedInstancesInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
  sort: selfHostedInstanceSortSchema.optional(),
  license: z.enum(["licensed", "open_source"]).optional(),
  activity: selfHostedInstanceActivitySchema.optional(),
  signal: selfHostedSignalSchema.optional(),
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
  traces28d: z.number(),
  newPerWeek: z.array(z.object({ weekStart: z.string(), count: z.number() })),
  signals: z.array(z.object({ signal: selfHostedSignalSchema, count: z.number() })),
  busiestOpenSource: z.array(selfHostedInstanceViewSchema),
  releases: z.array(z.object({ version: z.string(), count: z.number() })),
});
export interface SelfHostedInstanceSummarySchema extends Named<
  typeof selfHostedInstanceSummarySchemaDefinition
> {}
export const selfHostedInstanceSummarySchema: SelfHostedInstanceSummarySchema =
  selfHostedInstanceSummarySchemaDefinition;
export type SelfHostedInstanceSummary = z.infer<typeof selfHostedInstanceSummarySchema>;

/** Read only: an install reported every number here (ADR-156 §10). */
export const selfHostedInstancesTrpc = defineTrpcContract("selfHostedInstances")
  .query("getAll")
  .withInput(listSelfHostedInstancesInputSchema)
  .withOutput(selfHostedInstancePageSchema)

  .query("getById")
  .withInput(selfHostedInstanceIdInputSchema)
  .withOutput(selfHostedInstanceDetailSchema)

  .query("summary")
  .withInput(z.void())
  .withOutput(selfHostedInstanceSummarySchema)
  .build();
