import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  INGESTION_SOURCE_DESCRIPTION_MAX,
  INGESTION_SOURCE_NAME_MAX,
} from "../ingestion/ingestion-source.commands.ts";

/** The pull adapter that reads an AWS Security Lake subscriber queue. */
export const SECURITY_LAKE_ADAPTER_ID = "aws_security_lake" as const;
/** The `SourceType` Security Lake events are stored under in governance_ocsf_events. */
export const SECURITY_LAKE_SOURCE_TYPE = "security_lake" as const;

/** The Security Lake native AWS sources that carry CloudTrail management and data events. */
export const SECURITY_LAKE_CLOUDTRAIL_SOURCES = [
  "CLOUD_TRAIL_MGMT",
  "S3_DATA",
  "LAMBDA_EXECUTION",
] as const;

const securityLakePullConfigSchemaDefinition = z.object({
  adapter: z.literal(SECURITY_LAKE_ADAPTER_ID),
  /** The Region of the subscriber queue and the lake bucket. */
  region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "an AWS Region such as eu-west-1"),
  /** The role Security Lake created for this subscriber, assumed with the external id. */
  subscriberRoleArn: z.string().regex(/^arn:aws[a-z-]*:iam::\d{12}:role\/.+$/, "an IAM role ARN"),
  /** The subscriber's SQS queue that receives an object-created notification per Parquet file. */
  queueUrl: z.string().url(),
  sources: z
    .array(z.enum(SECURITY_LAKE_CLOUDTRAIL_SOURCES))
    .min(1)
    .default([...SECURITY_LAKE_CLOUDTRAIL_SOURCES]),
  /** Messages read per run; the rest wait on the queue for the next run. */
  maxMessagesPerRun: z.number().int().min(1).max(1000).default(100),
  /** A message whose object failed this many reads is recorded as poison and deleted. */
  maxReceives: z.number().int().min(1).max(20).default(3),
  /** Overrides for an S3 and SQS compatible endpoint, used for local testing. */
  s3Endpoint: z.string().url().optional(),
  sqsEndpoint: z.string().url().optional(),
  schedule: z.string().default("*/5 * * * *"),
});
export interface SecurityLakePullConfigSchema extends Named<
  typeof securityLakePullConfigSchemaDefinition
> {}
export const securityLakePullConfigSchema: SecurityLakePullConfigSchema =
  securityLakePullConfigSchemaDefinition;
export type SecurityLakePullConfig = z.infer<typeof securityLakePullConfigSchema>;

/** A message or object the reader gave up on, kept on the source health. */
const securityLakePoisonSchemaDefinition = z.object({
  messageId: z.string(),
  key: z.string(),
  reason: z.string(),
  at: z.number(),
});

/** The source health, folded from each run and stored as the source's pull cursor. */
const securityLakeHealthSchemaDefinition = z.object({
  lastReadAt: z.number().nullable(),
  /** Milliseconds from the oldest event written in the last run to that run. */
  lagMs: z.number().nullable(),
  runs: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  objects: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  retried: z.number().int().nonnegative(),
  poisonCount: z.number().int().nonnegative(),
  /** The latest poison entries, newest last. */
  poison: z.array(securityLakePoisonSchemaDefinition).max(20),
});
export interface SecurityLakeHealthSchema extends Named<
  typeof securityLakeHealthSchemaDefinition
> {}
export const securityLakeHealthSchema: SecurityLakeHealthSchema =
  securityLakeHealthSchemaDefinition;
export type SecurityLakeHealth = z.infer<typeof securityLakeHealthSchema>;

/** The access keys a Security Lake source reads with; stored sealed, never returned. */
const securityLakeCredentialsSchemaDefinition = z.object({
  aws_access_key_id: z.string().trim().min(1),
  aws_secret_access_key: z.string().trim().min(1),
  aws_session_token: z.string().trim().min(1).optional(),
});

const securityLakeSourceSettingsDefinition = securityLakePullConfigSchemaDefinition.omit({
  adapter: true,
});

/** Settings sent over the stored ones: only the keys sent change. */
const securityLakeSettingsChangeDefinition = z
  .object({
    ...securityLakeSourceSettingsDefinition.shape,
    sources: z.array(z.enum(SECURITY_LAKE_CLOUDTRAIL_SOURCES)).min(1),
    maxMessagesPerRun: z.number().int().min(1).max(1000),
    maxReceives: z.number().int().min(1).max(20),
    schedule: z.string(),
    /** An explicit null removes the override, so the source reads the AWS default again. */
    s3Endpoint: z.string().url().nullable(),
    sqsEndpoint: z.string().url().nullable(),
  })
  .partial();

const securityLakeSourceCreateInputSchemaDefinition = z.object({
  name: z.string().min(1).max(INGESTION_SOURCE_NAME_MAX),
  description: z.string().max(INGESTION_SOURCE_DESCRIPTION_MAX).nullable().optional(),
  config: securityLakeSourceSettingsDefinition,
  credentials: securityLakeCredentialsSchemaDefinition,
});
export interface SecurityLakeSourceCreateInputSchema extends Named<
  typeof securityLakeSourceCreateInputSchemaDefinition
> {}
export const securityLakeSourceCreateInputSchema: SecurityLakeSourceCreateInputSchema =
  securityLakeSourceCreateInputSchemaDefinition;
export type SecurityLakeSourceCreateInput = z.infer<typeof securityLakeSourceCreateInputSchema>;
/** What a caller sends: fields with a schema default may be left out. */
export type SecurityLakeSourceCreateRequest = z.input<typeof securityLakeSourceCreateInputSchema>;

const securityLakeSourceUpdateInputSchemaDefinition = z.object({
  name: z.string().min(1).max(INGESTION_SOURCE_NAME_MAX).optional(),
  description: z.string().max(INGESTION_SOURCE_DESCRIPTION_MAX).nullable().optional(),
  /** Only the keys sent change; the rest keep their stored value, so no schema default applies. */
  config: securityLakeSettingsChangeDefinition.optional(),
  credentials: securityLakeCredentialsSchemaDefinition.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
export interface SecurityLakeSourceUpdateInputSchema extends Named<
  typeof securityLakeSourceUpdateInputSchemaDefinition
> {}
export const securityLakeSourceUpdateInputSchema: SecurityLakeSourceUpdateInputSchema =
  securityLakeSourceUpdateInputSchemaDefinition;
export type SecurityLakeSourceUpdateInput = z.infer<typeof securityLakeSourceUpdateInputSchema>;
/** What a caller sends: fields with a schema default may be left out. */
export type SecurityLakeSourceUpdateRequest = z.input<typeof securityLakeSourceUpdateInputSchema>;

const securityLakeSourceSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  region: z.string(),
  queueUrl: z.string(),
  subscriberRoleArn: z.string(),
  /** Generated by LangWatch on create; the role's trust policy requires it as `sts:ExternalId`. */
  externalId: z.string(),
  sources: z.array(z.enum(SECURITY_LAKE_CLOUDTRAIL_SOURCES)),
  schedule: z.string().nullable(),
});
export interface SecurityLakeSourceSchema extends Named<
  typeof securityLakeSourceSchemaDefinition
> {}
export const securityLakeSourceSchema: SecurityLakeSourceSchema =
  securityLakeSourceSchemaDefinition;
export type SecurityLakeSource = z.infer<typeof securityLakeSourceSchema>;

const securityLakeConnectionTestSchemaDefinition = z.object({
  ok: z.boolean(),
  /** Messages waiting on the subscriber queue and messages handed out, when the queue answered. */
  waiting: z.number().int().nullable(),
  inFlight: z.number().int().nullable(),
  error: z.string().nullable(),
});
export interface SecurityLakeConnectionTestSchema extends Named<
  typeof securityLakeConnectionTestSchemaDefinition
> {}
export const securityLakeConnectionTestSchema: SecurityLakeConnectionTestSchema =
  securityLakeConnectionTestSchemaDefinition;
export type SecurityLakeConnectionTest = z.infer<typeof securityLakeConnectionTestSchema>;

const securityLakeSourceHealthSchemaDefinition = z.object({
  sourceId: z.string(),
  status: z.string(),
  /** The last run's failure, when it failed. */
  lastError: z.string().nullable(),
  health: securityLakeHealthSchemaDefinition,
});
export interface SecurityLakeSourceHealthSchema extends Named<
  typeof securityLakeSourceHealthSchemaDefinition
> {}
export const securityLakeSourceHealthSchema: SecurityLakeSourceHealthSchema =
  securityLakeSourceHealthSchemaDefinition;
export type SecurityLakeSourceHealth = z.infer<typeof securityLakeSourceHealthSchema>;

/**
 * A connection test of the source named in the path. Settings and keys sent are tested over the
 * stored ones without saving them; an empty body tests the stored source.
 */
const securityLakeConnectionTestInputSchemaDefinition = z
  .object({
    config: securityLakeSettingsChangeDefinition.optional(),
    credentials: securityLakeCredentialsSchemaDefinition.optional(),
  })
  .strict();
export interface SecurityLakeConnectionTestInputSchema extends Named<
  typeof securityLakeConnectionTestInputSchemaDefinition
> {}
export const securityLakeConnectionTestInputSchema: SecurityLakeConnectionTestInputSchema =
  securityLakeConnectionTestInputSchemaDefinition;
export type SecurityLakeConnectionTestInput = z.infer<typeof securityLakeConnectionTestInputSchema>;
export type SecurityLakeConnectionTestRequest = z.input<
  typeof securityLakeConnectionTestInputSchema
>;

const securityLakeCallerSchemaDefinition = z.object({
  principalArn: z.string(),
  models: z.array(z.string()),
  regions: z.array(z.string()),
  lastCallMs: z.number(),
  callCount: z.number(),
});
export interface SecurityLakeCallerSchema extends Named<
  typeof securityLakeCallerSchemaDefinition
> {}
/** A principal seen calling a model in Security Lake. */
export const securityLakeCallerSchema: SecurityLakeCallerSchema =
  securityLakeCallerSchemaDefinition;
export type SecurityLakeCaller = z.infer<typeof securityLakeCallerSchema>;

const securityLakeCallersSchemaDefinition = z.object({
  callers: z.array(securityLakeCallerSchema),
});
export interface SecurityLakeCallersSchema extends Named<
  typeof securityLakeCallersSchemaDefinition
> {}
export const securityLakeCallersSchema: SecurityLakeCallersSchema =
  securityLakeCallersSchemaDefinition;
export type SecurityLakeCallers = z.infer<typeof securityLakeCallersSchema>;
