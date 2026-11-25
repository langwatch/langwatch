import type { WebhookMiddlewareOptions } from "./middleware-options.ts";
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookSignatureVerificationError,
} from "./verify-signature.ts";

/** The slice of Hono's context the middleware reads; Hono's own `Context` satisfies it. */
export interface HonoLikeContext {
  req: { raw: Request; header(name: string): string | undefined };
  json(body: unknown, status: 401): Response;
}

export type { WebhookMiddlewareOptions };

/**
 * `app.post("/hooks", langwatchWebhook({ secret }), handler)`: answers 401 with the failure
 * code when the signature does not verify. The handler can still read the body.
 */
export function langwatchWebhook(options: WebhookMiddlewareOptions) {
  return async (context: HonoLikeContext, next: () => Promise<void>): Promise<Response | void> => {
    const body = new Uint8Array(await context.req.raw.clone().arrayBuffer());
    try {
      await verifyWebhookSignature({
        ...options,
        body,
        header: context.req.header(WEBHOOK_SIGNATURE_HEADER),
      });
    } catch (error) {
      if (!(error instanceof WebhookSignatureVerificationError)) throw error;
      return context.json({ error: error.code }, 401);
    }
    await next();
  };
}
