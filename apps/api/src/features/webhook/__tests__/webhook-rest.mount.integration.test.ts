/**
 * @vitest-environment node
 * The outbound-webhook endpoint registry, driven through the runtime's own
 * `mount`, not a hand-rolled Hono app.
 */
import type { RestOrganizationCredential } from "@langwatch/api/rest";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountWebhookRest } from "../webhook-rest.mount.ts";

describe("given an organization key on the webhook endpoint registry", () => {
  describe("when the organization lists its endpoints", () => {
    it("reads them back through the installed application", async () => {
      const getAll = vi.fn(async () => []);
      const webhooksApp = { getAll } as unknown as WebhookApi;

      const resolved: RestOrganizationCredential = {
        organizationId: "organization-1",
        apiKeyId: "apikey-1",
        userId: null,
      };
      const runtime = createApiRestRuntime({
        projectCredential: () => {
          throw new Error("This suite composed no project credential door.");
        },
        organizationCredential: () =>
          Promise.resolve({ ok: true, resolved, markUsed: () => {} }),
        organizationIdentity: () => {
          throw new Error("This suite composed no organization identity door.");
        },
        routeAuthorization: () => {
          throw new Error("This suite authorizes no route-scoped permission.");
        },
        errors: (error, context) => context.json({ error: String(error) }, 500),
        // Not exercised by this GET: the runtime requires a port bound wherever any
        // route in the family declares itself replayable.
        idempotency: () => {
          throw new Error("this suite calls no replayable route");
        },
      });

      const mounted = mountWebhookRest(runtime, { webhooks: () => webhooksApp });
      const hono = new Hono().route("/", mounted);

      const response = await hono.fetch(
        new Request("http://api.test/api/webhooks/v1/endpoints", {
          headers: { authorization: "Bearer organization-key" },
        }),
      );

      expect(response.status).not.toBe(404);
    });
  });
});
