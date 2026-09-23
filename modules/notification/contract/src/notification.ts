import { z } from "zod";

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

export const notificationMetadataSchema = z.record(z.string(), jsonValueSchema);

export const notificationSchema = z
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

export type Notification = z.infer<typeof notificationSchema>;

export const createNotificationCommandSchema = z
  .object({
    organizationId: z.string().min(1),
    projectId: z.string().nullable().optional(),
    metadata: notificationMetadataSchema,
    sentAt: z.date(),
  })
  .strict();

export type CreateNotificationCommand = z.infer<typeof createNotificationCommandSchema>;

export const notificationRecentQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    since: z.date(),
  })
  .strict();

export type NotificationRecentQuery = z.infer<typeof notificationRecentQuerySchema>;

/** How mail leaves this install, as the checkup reads it (specs/self-hosting/checkup.feature). */
export const mailDeliveryViewSchema = z
  .object({
    /** The gateway this deployment sends through; absent where none is configured. */
    provider: z.string().optional(),
    /** Whether an SMTP relay is named, so a connection to it can be verified. */
    smtpConfigured: z.boolean(),
  })
  .strict();

export type MailDeliveryView = z.infer<typeof mailDeliveryViewSchema>;
