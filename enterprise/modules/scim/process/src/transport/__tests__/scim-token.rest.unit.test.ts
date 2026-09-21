// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The management door onto SCIM tokens: where the value appears, where it
 * never appears again, and which organization a mint belongs to.
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { ScimTokenNotFoundError } from "@langwatch/enterprise-scim-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { scimTokenRest, scimTokenRestActor } from "../scim-token.rest.ts";
import { ScimServiceFake, scimTestApp } from "./support/scim-app.fixture.ts";

const boundaryErrorHandler: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json({ code: error.code }, (error.httpStatus ?? 500) as ContentfulStatusCode);
  }

  return context.json({ error: String(error) }, 500);
};

const MINTED = "9d8ac1f0a9e0f2b8c1d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8";

class TokenDirectoryFake extends ScimServiceFake {
  override readonly generateToken = vi.fn(async () => ({
    token: MINTED,
    tokenId: "scim_token_1",
    connectionId: "ssoc_okta",
  }));
  override readonly listTokens = vi.fn(async () => [
    {
      id: "scim_token_1",
      connectionId: "ssoc_okta",
      description: "Okta production",
      createdAt: new Date("2026-08-25T12:00:00.000Z"),
      lastUsedAt: null,
    },
  ]);
  override readonly revokeToken = vi.fn(async () => ({ success: true as const }));
}

function mount(scim: TokenDirectoryFake = new TokenDirectoryFake()) {
  const { app, audited } = scimTestApp({ scim });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user_ana" },
        scope: { tier: "organization" as const, id: "org_acme" },
      }),
      identify: () => ({
        actor: { type: "user", id: "user_ana" },
        scope: { tier: "organization" as const, id: "org_acme" },
      }),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });
  const hono = runtime.mount(scimTokenRest.router(), {
    app: () => app,
    facts: [{ middleware: scimTokenRestActor, resolve: () => ({ actorId: "user_ana" }) }],
    onError: boundaryErrorHandler,
  });

  return {
    audited,
    scim,
    request: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test/api/scim-tokens${path}`, init)),
  };
}

describe("given the SCIM tokens management family", () => {
  describe("when the organization's tokens are listed", () => {
    it("describes them without a value or a hash anywhere in the answer", async () => {
      const api = mount();

      const response = await api.request("");
      const body = (await response.json()) as { tokens: { id: string }[] };

      expect(response.status).toBe(200);
      expect(body.tokens).toEqual([
        expect.objectContaining({ id: "scim_token_1", description: "Okta production" }),
      ]);
      expect(JSON.stringify(body)).not.toContain(MINTED);
      expect(JSON.stringify(body)).not.toMatch(/hash/i);
      expect(api.scim.listTokens).toHaveBeenCalledWith({ organizationId: "org_acme" });
    });
  });

  describe("when a token is minted", () => {
    it("answers the value once, at 201, with the connection it reaches", async () => {
      const api = mount();

      const response = await api.request("", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "ssoc_okta", description: "Okta production" }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        id: "scim_token_1",
        token: MINTED,
        connectionId: "ssoc_okta",
        description: "Okta production",
      });
      // The connection is the token's whole write authority: a door that
      // dropped it refused every REST mint while tRPC's worked.
      expect(api.scim.generateToken).toHaveBeenCalledWith({
        organizationId: "org_acme",
        connectionId: "ssoc_okta",
        description: "Okta production",
      });
    });

    it("mints for the organization the credential resolved, never one the body names", async () => {
      const api = mount();

      await api.request("", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "ssoc_okta", organizationId: "org_somebody_else" }),
      });

      expect(api.scim.generateToken).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_acme" }),
      );
      expect(api.audited).toEqual([
        {
          userId: "user_ana",
          organizationId: "org_acme",
          action: "management.scimToken.create",
          args: { tokenId: "scim_token_1", connectionId: "ssoc_okta" },
        },
      ]);
    });
  });

  describe("when a token is revoked", () => {
    it("revokes it in the caller's own organization and records the act", async () => {
      const api = mount();

      const response = await api.request("/scim_token_1", { method: "DELETE" });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(api.scim.revokeToken).toHaveBeenCalledWith({
        organizationId: "org_acme",
        tokenId: "scim_token_1",
      });
      expect(api.audited).toEqual([
        expect.objectContaining({ action: "management.scimToken.delete", userId: "user_ana" }),
      ]);
    });

    it("answers 404 scim_token_not_found for an id that is unknown or already revoked", async () => {
      const scim = new TokenDirectoryFake();
      scim.revokeToken.mockRejectedValueOnce(new ScimTokenNotFoundError("scim_token_gone"));
      const api = mount(scim);

      const response = await api.request("/scim_token_gone", { method: "DELETE" });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: "scim_token_not_found" });
      expect(api.audited).toEqual([]);
    });
  });
});
