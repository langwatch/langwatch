// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { createHmac } from "node:crypto";

import { createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

import { scimWebhookRest } from "../scim-webhook.rest.ts";
import { ScimServiceFake, scimTestApp } from "./support/scim-app.fixture.ts";

const SECRET = "deployment-shared-secret";

const createEvent = [
  {
    type: "sscim",
    description: "create",
    details: { userName: "ada@victim-domain.com", body: { name: { givenName: "Ada" } } },
  },
];

/** The two tokens this file presents, and the tenant each names. */
const DIRECTORY_TOKENS: Readonly<Record<string, string>> = {
  scim_token_attacker: "org_attacker",
  scim_token_victim: "org_victim",
};

class DirectoryFake extends ScimServiceFake {
  override readonly verifyToken = vi.fn(async ({ token }: { token: string }) => {
    const organizationId = DIRECTORY_TOKENS[token];

    return organizationId
      ? ({ status: "ok", organizationId, connectionId: null } as const)
      : ({ status: "invalid_token" } as const);
  });
  override readonly createUser = vi.fn(async () => ({}) as never);
  override readonly findOrganizationBySsoDomain = vi.fn(async () => ({ id: "org_victim" }));
}

function signature(body: string, options: { secret?: string; atSeconds?: number } = {}): string {
  const t = options.atSeconds ?? Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", options.secret ?? SECRET)
    .update(`${t}.${body}`)
    .digest("hex");

  return `t=${t},v1=${digest}`;
}

function mount(options: { secret?: string | undefined } = {}) {
  const scim = new DirectoryFake();
  const { app } = scimTestApp({
    scim,
    webhookSecret: "secret" in options ? options.secret : SECRET,
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("This family resolves its own credential.");
      },
    },
  });

  const hono = runtime.mount(scimWebhookRest.router(), {
    app: () => app,
    credential: "public",
    onError: (error, context) => context.json({ error: String(error) }, 500),
  });

  return {
    scim,
    post: (init: { body: unknown; headers?: Record<string, string> }) => {
      const body = JSON.stringify(init.body);

      return hono.fetch(
        new Request("http://api.test/api/webhooks/auth0-scim", {
          method: "POST",
          body,
          headers: { "content-type": "application/json", ...init.headers },
        }),
      );
    },
  };
}

describe("given the Auth0 SCIM webhook intake", () => {
  describe("when the delivery is signed and carries a directory token", () => {
    /** @scenario "A signed SCIM webhook delivery provisions the token's own organization" */
    it("provisions the organization the credential names, not the one the payload implies", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: {
          authorization: "Bearer scim_token_attacker",
          "x-langwatch-signature": signature(JSON.stringify(body)),
        },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ received: true });
      expect(api.scim.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_attacker" }),
      );
      expect(api.scim.findOrganizationBySsoDomain).not.toHaveBeenCalled();
    });
  });

  describe("when the delivery presents no directory token", () => {
    /** @scenario "A SCIM webhook delivery without a directory token provisions nothing" */
    it("refuses the delivery and provisions nothing", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: { "x-langwatch-signature": signature(JSON.stringify(body)) },
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
      expect(api.scim.createUser).not.toHaveBeenCalled();
    });
  });

  describe("when the presented secret is not the configured one", () => {
    /** @scenario "A SCIM webhook delivery signed with the wrong secret is refused" */
    it("refuses a delivery signed with another secret", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: {
          authorization: "Bearer scim_token_attacker",
          "x-langwatch-signature": signature(JSON.stringify(body), { secret: "guessed" }),
        },
      });

      expect(response.status).toBe(401);
      expect(api.scim.createUser).not.toHaveBeenCalled();
    });
  });

  describe("when a captured delivery is sent twice", () => {
    /** @scenario "A replayed SCIM webhook delivery is refused" */
    it("refuses the replay", async () => {
      const api = mount();
      const body = createEvent;
      const headers = {
        authorization: "Bearer scim_token_attacker",
        "x-langwatch-signature": signature(JSON.stringify(body)),
      };

      const first = await api.post({ body, headers });
      const second = await api.post({ body, headers });

      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      expect(api.scim.createUser).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the delivery is older than the freshness window", () => {
    /** @scenario "A SCIM webhook delivery outside the freshness window is refused" */
    it("refuses a stale timestamp", async () => {
      const api = mount();
      const body = createEvent;

      const response = await api.post({
        body,
        headers: {
          authorization: "Bearer scim_token_attacker",
          "x-langwatch-signature": signature(JSON.stringify(body), {
            atSeconds: Math.floor(Date.now() / 1000) - 3600,
          }),
        },
      });

      expect(response.status).toBe(401);
      expect(api.scim.createUser).not.toHaveBeenCalled();
    });
  });

  describe("when the deployment configured no webhook secret", () => {
    /** @scenario "A deployment without directory sync does not serve the SCIM webhook" */
    it("answers as though the path does not exist", async () => {
      const api = mount({ secret: undefined });

      const response = await api.post({ body: createEvent });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Webhook not configured" });
    });
  });
});

describe("given the Auth0 SCIM webhook declaration", () => {
  const declaration = scimWebhookRest.router();

  describe("when its address and door are read", () => {
    it("publishes the one literal path Auth0 holds, with no twin and no credential", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(false);
      expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
        "post /api/webhooks/auth0-scim",
      ]);
      expect(declaration.routes[0]?.access?.kind).toBe("public");
      // The HMAC is computed over these exact characters.
      expect(declaration.routes[0]?.rawBody).toEqual({
        form: "text",
        mediaType: "application/json",
      });
    });
  });
});
