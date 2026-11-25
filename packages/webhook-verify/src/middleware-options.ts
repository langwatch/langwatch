import type { WebhookSignatureScheme } from "./verify-signature.ts";

export interface WebhookMiddlewareOptions {
  /** One secret, or every secret valid during a rotation. */
  secret: string | readonly string[];
  /** Defaults to `v1`; `sha256` only for an endpoint that signs the legacy way. */
  scheme?: WebhookSignatureScheme;
  toleranceSeconds?: number;
}
