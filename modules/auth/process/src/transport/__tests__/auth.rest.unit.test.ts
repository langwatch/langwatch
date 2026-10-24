/**
 * @vitest-environment node
 * The `/api/auth/*` handshake door: each answer the sign-in door decides, written as the
 * response the browser has always received. @see specs/auth/auth-rest-family-mounted.feature
 */
import { describe, expect, it } from "vitest";

import { authHandshakeResponseOf } from "../auth.rest.ts";

const ERROR_PAGE = "https://app.test/auth/error?error=signin_failed";

describe("authHandshakeResponseOf", () => {
  describe("when the call came from another origin", () => {
    /** @scenario "A sign-in call from another origin is refused with a 403" */
    it("answers the bare 403 with the invalid origin code", async () => {
      const response = authHandshakeResponseOf({ kind: "refused-origin" });

      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toEqual({
        message: "Invalid origin",
        code: "INVALID_ORIGIN",
      });
    });
  });

  describe("when Better Auth's response passes untouched", () => {
    /** @scenario "The sign-in engine's answer passes through untouched" */
    it("answers that very response", () => {
      const engine = Response.json({ handledByBetterAuth: true });

      expect(authHandshakeResponseOf({ kind: "engine", response: engine })).toBe(engine);
    });
  });

  describe("when a step replaced the redirect target", () => {
    /** @scenario "A replaced redirect target keeps the engine's status, headers and cookies" */
    it("keeps the engine's status, headers and body and swaps only the location", async () => {
      const headers = new Headers({ location: "https://app.test/old", "x-engine": "1" });
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      const engine = new Response("body", { status: 302, headers });

      const response = authHandshakeResponseOf({
        kind: "engine",
        response: engine,
        location: "https://app.test/new",
      });

      expect(response).not.toBe(engine);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://app.test/new");
      expect(response.headers.get("x-engine")).toBe("1");
      expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
      await expect(response.text()).resolves.toBe("body");
    });
  });

  describe("when a sign-in callback failed on the server", () => {
    /** @scenario "A sign-in callback that failed on the server redirects to the error screen" */
    it("redirects to the error screen with no body", async () => {
      const response = authHandshakeResponseOf({ kind: "sign-in-failed", location: ERROR_PAGE });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(ERROR_PAGE);
      await expect(response.text()).resolves.toBe("");
    });
  });
});
