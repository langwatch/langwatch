/**
 * Notices LangWatch staff send self-hosted installs, as the Ops screen on Cloud writes them.
 * Browser mirror of the licensing contract and enterprise-ops tRPC, as license-registry.trpc.ts is.
 * @see ../../../specs/self-hosted-notices.feature
 */
import type { Named } from "@langwatch/module";
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  SELF_HOSTED_NOTICE_BODY_MAX,
  SELF_HOSTED_NOTICE_RELEASE_PATTERN,
  SELF_HOSTED_NOTICE_SEVERITIES,
  SELF_HOSTED_NOTICE_TITLE_MAX,
} from "../../self-hosted-notice.ts";

/** A draft is never sent; a withdrawn notice stops being sent at the next report. */
export const SELF_HOSTED_NOTICE_STATUSES = ["draft", "published", "withdrawn"] as const;
export type SelfHostedNoticeStatus = (typeof SELF_HOSTED_NOTICE_STATUSES)[number];

/** What staff write, and edit as a whole. */
const selfHostedNoticeFieldsShape = {
  severity: z.enum(SELF_HOSTED_NOTICE_SEVERITIES),
  title: z.string().trim().min(1).max(SELF_HOSTED_NOTICE_TITLE_MAX),
  body: z.string().max(SELF_HOSTED_NOTICE_BODY_MAX),
  url: z.url({ protocol: /^https$/ }).nullable(),
  fixedIn: z.string().regex(SELF_HOSTED_NOTICE_RELEASE_PATTERN).nullable(),
  /** ISO 8601. From this instant the notice is no longer sent; null sends it until withdrawn. */
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
};

const createSelfHostedNoticeInputSchemaDefinition = z.object(selfHostedNoticeFieldsShape);
export interface CreateSelfHostedNoticeInputSchema extends Named<
  typeof createSelfHostedNoticeInputSchemaDefinition
> {}
export const createSelfHostedNoticeInputSchema: CreateSelfHostedNoticeInputSchema =
  createSelfHostedNoticeInputSchemaDefinition;
export type CreateSelfHostedNoticeInput = z.infer<typeof createSelfHostedNoticeInputSchema>;

const updateSelfHostedNoticeInputSchemaDefinition = z.object({
  id: z.string().min(1),
  ...selfHostedNoticeFieldsShape,
});
export interface UpdateSelfHostedNoticeInputSchema extends Named<
  typeof updateSelfHostedNoticeInputSchemaDefinition
> {}
export const updateSelfHostedNoticeInputSchema: UpdateSelfHostedNoticeInputSchema =
  updateSelfHostedNoticeInputSchemaDefinition;
export type UpdateSelfHostedNoticeInput = z.infer<typeof updateSelfHostedNoticeInputSchema>;

const selfHostedNoticeIdInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface SelfHostedNoticeIdInputSchema extends Named<
  typeof selfHostedNoticeIdInputSchemaDefinition
> {}
export const selfHostedNoticeIdInputSchema: SelfHostedNoticeIdInputSchema =
  selfHostedNoticeIdInputSchemaDefinition;

/** One notice as Cloud admin lists it; instants are ISO 8601. */
const selfHostedNoticeViewSchemaDefinition = z.object({
  id: z.string(),
  severity: z.enum(SELF_HOSTED_NOTICE_SEVERITIES),
  title: z.string(),
  body: z.string(),
  url: z.string().nullable(),
  fixedIn: z.string().nullable(),
  status: z.enum(SELF_HOSTED_NOTICE_STATUSES),
  expiresAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  /** The staff member who published it, by user id. */
  publishedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export interface SelfHostedNoticeViewSchema extends Named<
  typeof selfHostedNoticeViewSchemaDefinition
> {}
export const selfHostedNoticeViewSchema: SelfHostedNoticeViewSchema =
  selfHostedNoticeViewSchemaDefinition;
export type SelfHostedNoticeView = z.infer<typeof selfHostedNoticeViewSchema>;

export const selfHostedNoticesTrpc = defineTrpcContract("selfHostedNotices")
  .query("getAll")
  .withInput(z.void())
  .withOutput(z.array(selfHostedNoticeViewSchema))

  .mutation("create")
  .withInput(createSelfHostedNoticeInputSchema)
  .withOutput(selfHostedNoticeViewSchema)

  .mutation("update")
  .withInput(updateSelfHostedNoticeInputSchema)
  .withOutput(selfHostedNoticeViewSchema)

  .mutation("publish")
  .withInput(selfHostedNoticeIdInputSchema)
  .withOutput(selfHostedNoticeViewSchema)

  .mutation("withdraw")
  .withInput(selfHostedNoticeIdInputSchema)
  .withOutput(selfHostedNoticeViewSchema)
  .build();
