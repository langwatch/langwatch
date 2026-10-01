/** @vitest-environment jsdom */

import { SsoTestSignInToken } from "@langwatch/auth-contract";
import { createUi } from "@langwatch/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authWeb } from "../auth.web.ts";
import { signInCapability } from "../behavior/sign-in-capability.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs auth", () => {
  describe("when the kernel renders with only a transport supplied", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([authWeb] as const)
        .withTransport({ query: () => Promise.resolve(null) })
        .render();

      expect(installed.modules).toContain(authWeb);
    });
  });

  describe("when a screen the declaration names is asked for", () => {
    it.each([
      ["pages/auth/signin"],
      ["pages/auth/signup"],
      ["pages/auth/forgot-password"],
      ["pages/auth/reset-password"],
      ["pages/auth/verify-email"],
      ["pages/auth/error"],
      ["pages/auth/join"],
      ["pages/invite/accept"],
    ] as const)("answers with a component for %s", async (page) => {
      const screen = authWeb.installation.screens[page];
      const loaded = await screen?.load?.();

      expect(loaded).toHaveProperty("default");
    });
  });

  describe("when SSO's test sign-in loads what auth lent under its token", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("starts auth's sign-in for that connection and hands back the refusal", async () => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "PROVIDER_NOT_FOUND", message: "No provider" }), {
          status: 404,
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const lend = authWeb.installation.lends.find(
        (lent) => lent.token.key === SsoTestSignInToken.key,
      );
      const loaded = lend && "load" in lend ? await lend.load() : undefined;
      expect(loaded).toHaveProperty("default", signInCapability);

      const answer = await signInCapability.testSignIn({
        connectionId: "conn_1",
        callbackQuery: {},
      });

      expect(fetch).toHaveBeenCalledWith("/api/auth/sign-in/sso", expect.anything());
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        body: expect.stringContaining('"providerId":"conn_1"'),
      });
      expect(answer.error).toMatchObject({ code: "PROVIDER_NOT_FOUND", status: 404 });
    });
  });
});
