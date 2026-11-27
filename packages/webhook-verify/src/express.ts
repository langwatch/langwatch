import type { WebhookMiddlewareOptions } from "./middleware-options.ts";
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookSignatureVerificationError,
} from "./verify-signature.ts";

/** The slice of Express's request the middleware reads; mount `express.raw()` first. */
export interface ExpressLikeRequest {
  body?: unknown;
  header(name: string): string | undefined;
}
export interface ExpressLikeResponse {
  status(code: 401): { json(body: unknown): unknown };
}

export type { WebhookMiddlewareOptions };

/**
 * `app.post("/hooks", express.raw({ type: "application/json" }), langwatchWebhook({ secret }),
 * handler)`: answers 401 with the failure code when the signature does not verify.
 */
export function langwatchWebhook(options: WebhookMiddlewareOptions) {
  return async (
    request: ExpressLikeRequest,
    response: ExpressLikeResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    const rawBody = request.body;
    if (!(rawBody instanceof Uint8Array) && typeof rawBody !== "string") {
      next(new TypeError("langwatchWebhook needs the raw body: mount express.raw() before it"));
      return;
    }
    let refusal: WebhookSignatureVerificationError | undefined;
    try {
      await verifyWebhookSignature({
        ...options,
        body: rawBody,
        header: request.header(WEBHOOK_SIGNATURE_HEADER),
      });
    } catch (error) {
      if (!(error instanceof WebhookSignatureVerificationError)) throw error;
      refusal = error;
    }
    if (refusal) {
      response.status(401).json({ error: refusal.code });
      return;
    }
    next();
  };
}
