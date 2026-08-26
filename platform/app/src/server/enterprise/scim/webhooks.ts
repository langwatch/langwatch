// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Thin Auth0 webhook mount; parsing and provisioning live in Enterprise SCIM. */
import { AppScimWebhookAdapter } from "~/runtime/app/scim/scim-transport.adapter";
import { createServiceApp, internalSecret } from "~/server/api/security";

const secured = createServiceApp({ basePath: "/api/webhooks" });
const scimWebhookApi = AppScimWebhookAdapter.create();

secured
  .access(
    internalSecret(
      "auth0 SCIM webhook shared secret compared against the Authorization header in-handler",
    ),
  )
  .post("/auth0-scim", async (c) => {
    const secret = c.app.config.auth0ScimWebhookSecret;
    if (!secret) return c.json({ error: "Webhook not configured" }, { status: 404 });
    if (c.req.header("authorization") !== secret)
      return c.json({ error: "Unauthorized" }, { status: 401 });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, { status: 400 });
    }
    await scimWebhookApi.handle(c.app.scim, Array.isArray(body) ? body : [body]);
    return c.json({ received: true });
  });

export const app = secured.hono;
