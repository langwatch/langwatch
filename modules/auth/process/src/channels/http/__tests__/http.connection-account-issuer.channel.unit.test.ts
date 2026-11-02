/**
 * A connection account row is never written without the issuer it belongs to (ADR-189).
 * Spec: specs/identity/account-issuer-namespace.feature
 */
import { describe, expect, it, vi } from "vitest";

import { refuseConnectionAccountWithoutIssuer } from "../http.better-auth-hooks.channel.ts";

const CONNECTION = "ssoc_acme";

function refuse({
  account,
  assertedIssuers = [],
}: {
  account: { providerId: string; issuer?: string };
  assertedIssuers?: readonly string[];
}) {
  const isConnection = vi.fn(
    async ({ providerId }: { providerId: string }) => providerId === CONNECTION,
  );
  const written = refuseConnectionAccountWithoutIssuer({ account, assertedIssuers, isConnection });
  return { written, isConnection };
}

describe("refuseConnectionAccountWithoutIssuer", () => {
  describe("when a connection row has no recorded issuer", () => {
    /** @scenario "A connection account row with no recorded issuer is refused when written" */
    it("refuses it as not linked", async () => {
      const { written } = refuse({ account: { providerId: CONNECTION } });

      await expect(written).rejects.toMatchObject({ body: { code: "OAuthAccountNotLinked" } });
    });
  });

  describe("when the assertion recorded an issuer for the subject", () => {
    /** @scenario "A connection account row with no recorded issuer is refused when written" */
    it("writes it without asking whether the provider is a connection", async () => {
      const { written, isConnection } = refuse({
        account: { providerId: CONNECTION },
        assertedIssuers: ["https://idp.acme.test"],
      });

      await expect(written).resolves.toBeUndefined();
      expect(isConnection).not.toHaveBeenCalled();
    });
  });

  describe("when the row states its own issuer", () => {
    it("writes it, as a confirmed link proposal does", async () => {
      const { written } = refuse({
        account: { providerId: CONNECTION, issuer: "https://idp.acme.test" },
      });

      await expect(written).resolves.toBeUndefined();
    });
  });

  describe("when the provider is not a connection", () => {
    /** @scenario "A connection account row with no recorded issuer is refused when written" */
    it("writes it as before", async () => {
      const { written } = refuse({ account: { providerId: "google" } });

      await expect(written).resolves.toBeUndefined();
    });
  });
});
