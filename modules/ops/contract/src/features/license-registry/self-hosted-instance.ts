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

const listSelfHostedInstancesInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(25),
  search: z.string().optional(),
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

/** Read only: an install reported every number here (ADR-156 §10). */
export const selfHostedInstancesTrpc = defineTrpcContract("selfHostedInstances")
  .query("getAll")
  .withInput(listSelfHostedInstancesInputSchema)
  .withOutput(selfHostedInstancePageSchema)

  .query("getById")
  .withInput(selfHostedInstanceIdInputSchema)
  .withOutput(selfHostedInstanceDetailSchema)
  .build();
