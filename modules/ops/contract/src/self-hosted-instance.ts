/** The registry of self-hosted installs (ADR-156, section 10), as the
 * backoffice reads it. `licensing` is enterprise, so every shape here is
 * declared locally rather than imported from it (as `license-registry.ts`). */
import { z } from "zod";

const selfHostedInstanceActivitySchema = z.enum(["reporting", "quiet", "gone"]);

/** One install as the backoffice reads it. */
export const selfHostedInstanceViewSchema = z.object({
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
export type SelfHostedInstanceView = z.infer<typeof selfHostedInstanceViewSchema>;

export const selfHostedInstancePageSchema = z.object({
  instances: z.array(selfHostedInstanceViewSchema),
  total: z.number(),
});
export type SelfHostedInstancePage = z.infer<typeof selfHostedInstancePageSchema>;

export const listSelfHostedInstancesInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(200).default(25),
  search: z.string().optional(),
});

export const selfHostedInstanceIdInputSchema = z.object({ id: z.string().min(1) });

/** One row of an install's report history. */
export const selfHostedReportSummarySchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
  version: z.string().nullable(),
  unknownFields: z.number(),
});

export const selfHostedInstanceDetailSchema = z.object({
  instance: selfHostedInstanceViewSchema,
  reports: z.array(selfHostedReportSummarySchema),
});
export type SelfHostedInstanceDetail = z.infer<typeof selfHostedInstanceDetailSchema>;
