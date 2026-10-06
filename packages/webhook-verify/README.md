# @langwatch/webhook-verify

Verify that a webhook delivery came from LangWatch, with middleware for Hono and Express. No
runtime dependencies; it uses Web Crypto, so it runs on Node 20+, Bun, Deno and edge runtimes.

```ts
import { verifyWebhookSignature } from "@langwatch/webhook-verify";

await verifyWebhookSignature({
  body: rawBody, // the bytes you received, not re-serialised JSON
  header: request.headers.get("X-LangWatch-Signature"),
  secret: [currentSecret, previousSecret], // every secret valid during a rotation
});
```

It resolves when the delivery is authentic and rejects with a `WebhookSignatureVerificationError`
whose `code` is `malformed_header`, `stale_timestamp` or `invalid_signature`.

## Middleware

```ts
// Hono
import { langwatchWebhook } from "@langwatch/webhook-verify/hono";
app.post("/hooks", langwatchWebhook({ secret }), handler);

// Express: the raw body first
import { langwatchWebhook } from "@langwatch/webhook-verify/express";
app.post("/hooks", express.raw({ type: "application/json" }), langwatchWebhook({ secret }), handler);
```

A delivery that does not verify is answered `401` with `{ "error": "<code>" }`.

## Signature schemes

- `v1` (default): `X-LangWatch-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]`, the HMAC-SHA256
  of `<t>.<raw body>`; timestamps outside 300 seconds are refused (`toleranceSeconds` changes it).
- `sha256`: the legacy `X-LangWatch-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body.
  Pass `scheme: "sha256"` only for a destination that signs this way.

Full guide: https://docs.langwatch.ai/features/webhooks#verifying-signatures
