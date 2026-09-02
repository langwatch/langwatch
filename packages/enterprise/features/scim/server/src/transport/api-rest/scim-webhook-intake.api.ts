// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Auth0 SCIM webhook's HTTP intake: `POST /api/webhooks/auth0-scim`.
 *
 * Thin on purpose — parsing and provisioning live in {@link ScimWebhookApi}.
 * The two answers this door owns are the ones the mount cannot delegate: an
 * install that configured no shared secret answers 404 rather than 401, so a
 * deployment that never enabled directory sync looks like one that never
 * served the path; and a presented secret that does not match answers 401.
 */
import { internalSecret } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import { ScimWebhookApi } from "../../api/scim-webhook/scim-webhook.api";
import type { ScimService } from "@langwatch/enterprise-scim-contract";

/** Everything the intake reaches that the SCIM boundary does not own. */
export type ScimWebhookRestPorts = Readonly<{
  /** The SAME application the protocol family provisions through. */
  scim: () => ScimService;
  /**
   * The shared secret Auth0 presents, or none.
   *
   * A function rather than a value, and its absence is a 404: an install that
   * configured no secret has no webhook, and answering 401 would confirm the
   * path exists to anyone who probed it.
   */
  webhookSecret: () => string | undefined;
}>;

/** Builds the `/api/webhooks/auth0-scim` family over one process's ports. */
export function createScimWebhookRestApp(options: {
  security: AppRestSecurity;
  ports: ScimWebhookRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/webhooks" });
  const scimWebhookApi = ScimWebhookApi.create();

  secured
    .access(
      internalSecret(
        "auth0 SCIM webhook shared secret compared against the Authorization header in-handler",
      ),
    )
    .post("/auth0-scim", async (c) => {
      const secret = ports.webhookSecret();
      if (!secret) return c.json({ error: "Webhook not configured" }, { status: 404 });
      if (c.req.header("authorization") !== secret)
        return c.json({ error: "Unauthorized" }, { status: 401 });
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON" }, { status: 400 });
      }
      await scimWebhookApi.handle({
        service: ports.scim(),
        events: Array.isArray(body) ? body : [body],
      });
      return c.json({ received: true });
    });

  return secured.hono;
}
