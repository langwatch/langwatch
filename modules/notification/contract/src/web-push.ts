import { z } from "zod";

/**
 * Web Push, as notification owns it (ADR-167): the browsers a person subscribed,
 * and one push a producer asks to send to all of them.
 * Spec: modules/notification/specs/web-push.feature
 */

/** Payload text caps, so a push stays well under the 4 KB the push services accept. */
export const WEB_PUSH_TITLE_MAX = 120;
export const WEB_PUSH_BODY_MAX = 400;

/** A day: a push the browser cannot take within it is dropped by the push service. */
export const WEB_PUSH_DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/** A base64url string, the encoding the browser's PushSubscription keys use. */
const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, "must be base64url");

/** What `PushSubscription.toJSON()` gives the page: the endpoint and the browser's keys. */
export const webPushSubscriptionInputSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((value) => value.startsWith("https://"), "a push endpoint is an https URL"),
    keys: z.object({ p256dh: base64UrlSchema.max(256), auth: base64UrlSchema.max(64) }).strict(),
  })
  .strict();

export type WebPushSubscriptionInput = z.infer<typeof webPushSubscriptionInputSchema>;

export const subscribeWebPushCommandSchema = z
  .object({
    userId: z.string().min(1),
    subscription: webPushSubscriptionInputSchema,
    userAgent: z.string().max(512).nullable().optional(),
  })
  .strict();

export type SubscribeWebPushCommand = z.infer<typeof subscribeWebPushCommandSchema>;

export const unsubscribeWebPushCommandSchema = z
  .object({ userId: z.string().min(1), endpoint: z.string().min(1).max(2048) })
  .strict();

export type UnsubscribeWebPushCommand = z.infer<typeof unsubscribeWebPushCommandSchema>;

/** One stored browser. */
export const webPushSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    endpoint: z.string().min(1),
    p256dh: z.string().min(1),
    auth: z.string().min(1),
    userAgent: z.string().nullable(),
    createdAt: z.date(),
    lastSuccessAt: z.date().nullable(),
  })
  .strict();

export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;

/**
 * What the service worker receives, decrypted. `tag` groups one subject's notifications so
 * a newer one replaces the older; `url` is where a click goes, on this installation's origin.
 */
export const webPushPayloadSchema = z
  .object({
    title: z.string().min(1).max(WEB_PUSH_TITLE_MAX),
    body: z.string().max(WEB_PUSH_BODY_MAX),
    url: z.string().min(1).max(2048),
    tag: z.string().min(1).max(200),
  })
  .strict();

export type WebPushPayload = z.infer<typeof webPushPayloadSchema>;

/**
 * One push to every browser of a person. The same `idempotencyKey` again sends nothing new;
 * `topic` lets a newer pending push about the same subject replace an older one.
 */
export const requestWebPushDeliveryCommandSchema = z
  .object({
    userId: z.string().min(1),
    /** The tenant the push is about; recorded on the outbox row. */
    projectId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(256),
    topic: z.string().min(1).max(256),
    message: webPushPayloadSchema,
    urgency: z.enum(["very-low", "low", "normal", "high"]).default("high"),
    ttlSeconds: z.number().int().min(0).max(WEB_PUSH_DEFAULT_TTL_SECONDS).optional(),
  })
  .strict();

export type RequestWebPushDeliveryCommand = z.input<typeof requestWebPushDeliveryCommandSchema>;

export const webPushDeliveryRequestedSchema = z
  .object({ queued: z.number().int().nonnegative() })
  .strict();

export type WebPushDeliveryRequested = z.infer<typeof webPushDeliveryRequestedSchema>;

/** The VAPID public key a browser subscribes with (`applicationServerKey`), base64url. */
export const webPushPublicKeySchema = z.object({ publicKey: z.string().min(1) }).strict();

export type WebPushPublicKey = z.infer<typeof webPushPublicKeySchema>;
