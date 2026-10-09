/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { aliasLegacyMicrosoftCallback } from "../legacy-callback-alias";

const HOST = "https://langwatch.acme.example";

describe("aliasLegacyMicrosoftCallback", () => {
  describe("when the request arrives at /api/auth/callback/azure-ad", () => {
    it("serves it at the Microsoft provider's path with the query kept", () => {
      const served = aliasLegacyMicrosoftCallback(
        new Request(`${HOST}/api/auth/callback/azure-ad?code=c&state=s`, {
          headers: { cookie: "a=b" },
        }),
      );

      expect(served.url).toBe(
        `${HOST}/api/auth/callback/microsoft?code=c&state=s`,
      );
      expect(served.headers.get("cookie")).toBe("a=b");
    });

    it("keeps the body of a form post", async () => {
      const served = aliasLegacyMicrosoftCallback(
        new Request(`${HOST}/api/auth/callback/azure-ad`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "code=c&state=s",
        }),
      );

      expect(served.method).toBe("POST");
      expect(new URL(served.url).pathname).toBe("/api/auth/callback/microsoft");
      expect(await served.text()).toBe("code=c&state=s");
    });
  });

  describe("when the request is for any other path", () => {
    it("returns the same request", () => {
      const request = new Request(`${HOST}/api/auth/callback/google?code=c`);

      expect(aliasLegacyMicrosoftCallback(request)).toBe(request);
    });
  });
});
