// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { appContextBindingsFor } from "~/app/api/middleware/app-context";
import { createTestApp } from "~/server/app-layer/presets";
import { app } from "../webhooks";

const webhookPath = "/api/webhooks/auth0-scim";

describe("Auth0 SCIM webhook transport", () => {
  it("is unavailable when the process has no webhook secret", async () => {
    const requestApp = createTestApp();

    const response = await app.request(
      webhookPath,
      {
        method: "POST",
        headers: { Authorization: "secret", "Content-Type": "application/json" },
        body: "[]",
      },
      appContextBindingsFor(requestApp),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Webhook not configured" });
  });

  it("compares the request against the composed secret", async () => {
    const baseApp = createTestApp();
    const requestApp = createTestApp({
      config: { ...baseApp.config, auth0ScimWebhookSecret: "configured-secret" },
    });

    const response = await app.request(
      webhookPath,
      {
        method: "POST",
        headers: { Authorization: "wrong-secret", "Content-Type": "application/json" },
        body: "[]",
      },
      appContextBindingsFor(requestApp),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("passes authenticated events to the canonical service", async () => {
    const baseApp = createTestApp();
    const requestApp = createTestApp({
      config: { ...baseApp.config, auth0ScimWebhookSecret: "configured-secret" },
    });

    const response = await app.request(
      webhookPath,
      {
        method: "POST",
        headers: {
          Authorization: "configured-secret",
          "Content-Type": "application/json",
        },
        body: "[]",
      },
      appContextBindingsFor(requestApp),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });
});
