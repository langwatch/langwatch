import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { webPushPublicKeySchema, webPushSubscriptionInputSchema } from "./web-push.ts";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const notificationMetadataSchemaDefinition = z.record(z.string(), jsonValueSchema);
export interface NotificationMetadataSchema extends Named<
  typeof notificationMetadataSchemaDefinition
> {}
export const notificationMetadataSchema: NotificationMetadataSchema =
  notificationMetadataSchemaDefinition;

const notificationSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().nullable(),
    projectId: z.string().nullable(),
    metadata: jsonValueSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
    sentAt: z.date(),
  })
  .strict();
export interface NotificationSchema extends Named<typeof notificationSchemaDefinition> {}
export const notificationSchema: NotificationSchema = notificationSchemaDefinition;

export type Notification = z.infer<typeof notificationSchema>;

const createNotificationCommandSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    projectId: z.string().nullable().optional(),
    metadata: notificationMetadataSchema,
    sentAt: z.date(),
  })
  .strict();
export interface CreateNotificationCommandSchema extends Named<
  typeof createNotificationCommandSchemaDefinition
> {}
export const createNotificationCommandSchema: CreateNotificationCommandSchema =
  createNotificationCommandSchemaDefinition;

export type CreateNotificationCommand = z.infer<typeof createNotificationCommandSchema>;

const notificationRecentQuerySchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    since: z.date(),
  })
  .strict();
export interface NotificationRecentQuerySchema extends Named<
  typeof notificationRecentQuerySchemaDefinition
> {}
export const notificationRecentQuerySchema: NotificationRecentQuerySchema =
  notificationRecentQuerySchemaDefinition;

export type NotificationRecentQuery = z.infer<typeof notificationRecentQuerySchema>;

/** How mail leaves this install, as the checkup reads it (specs/self-hosting/checkup.feature). */
const mailDeliveryViewSchemaDefinition = z
  .object({
    /** The gateway this deployment sends through; absent where none is configured. */
    provider: z.string().optional(),
    /** Whether an SMTP relay is named, so a connection to it can be verified. */
    smtpConfigured: z.boolean(),
    /** The transport logs in to the relay; an internal relay often takes none. */
    smtpSendsCredentials: z.boolean(),
    /** A gateway is named but its settings are unusable: not the same as having no email at all. */
    misconfigured: z.boolean(),
  })
  .strict();
export interface MailDeliveryViewSchema extends Named<typeof mailDeliveryViewSchemaDefinition> {}
export const mailDeliveryViewSchema: MailDeliveryViewSchema = mailDeliveryViewSchemaDefinition;

export type MailDeliveryView = z.infer<typeof mailDeliveryViewSchema>;

/** A file carried with a message, such as a licence key. */
const emailAttachmentSchemaDefinition = z
  .object({ filename: z.string().min(1), content: z.string(), contentType: z.string().min(1) })
  .strict();
export interface EmailAttachmentSchema extends Named<typeof emailAttachmentSchemaDefinition> {}
export const emailAttachmentSchema: EmailAttachmentSchema = emailAttachmentSchemaDefinition;

/**
 * One transactional message, already rendered. Notification writes the envelope: `to` is the
 * visible recipient, `undisclosedRecipients` go out unseen, `unsubscribe` becomes the RFC 8058
 * one-click pair, and `replyless` hides every recipient behind `no-reply+<tag>@<sender domain>`.
 */
const sendEmailCommandSchemaDefinition = z
  .object({
    to: z.union([z.string().min(1), z.array(z.string().min(1))]),
    subject: z.string(),
    html: z.string(),
    from: z.string().optional(),
    undisclosedRecipients: z.array(z.string().min(1)).optional(),
    unsubscribe: z.object({ url: z.string().url() }).strict().optional(),
    replyless: z
      .object({ tag: z.string().regex(/^[a-z0-9]+$/i) })
      .strict()
      .optional(),
    attachments: z.array(emailAttachmentSchema).optional(),
    /** Stable identity of one recipient's delivery; a retry carries the same one. */
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();
export interface SendEmailCommandSchema extends Named<typeof sendEmailCommandSchemaDefinition> {}
export const sendEmailCommandSchema: SendEmailCommandSchema = sendEmailCommandSchemaDefinition;

export type SendEmailCommand = z.infer<typeof sendEmailCommandSchema>;

/**
 * The browser's side of Web Push: the key to subscribe with, and the caller's own
 * browsers in and out. Spec: modules/notification/specs/web-push.feature
 */
export const notificationTrpc = defineTrpcContract("notification")
  .query("webPushPublicKey")
  .withInput(z.object({}).strict())
  .withOutput(webPushPublicKeySchema)

  .mutation("subscribeWebPush")
  .withInput(
    webPushSubscriptionInputSchema.safeExtend({ userAgent: z.string().max(512).optional() }),
  )

  .mutation("unsubscribeWebPush")
  .withInput(z.object({ endpoint: z.string().min(1).max(2048) }).strict())
  .build();
