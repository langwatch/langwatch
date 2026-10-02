import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import { webPushPublicKeySchema, webPushSubscriptionInputSchema } from "./web-push.ts";

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
