import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { orgRequestLedgerActor } from "../ledger-actor";

const contextWith = (values: Record<string, string | null | undefined>) =>
  ({
    get: (key: string) => values[key],
    req: { path: "/api/role-bindings", method: "POST" },
  }) as unknown as Context;

describe("the grants-ledger actor of an organization-authenticated request", () => {
  describe("when the key acts for a person", () => {
    it("names the person", () => {
      expect(
        orgRequestLedgerActor(
          contextWith({ apiKeyUserId: "user_1", apiKeyId: "apikey_1" }),
        ),
      ).toEqual({ type: "user", id: "user_1" });
    });
  });

  describe("when the key acts for nobody", () => {
    it("names the credential, so a provisioning run's writes group together", () => {
      expect(
        orgRequestLedgerActor(contextWith({ apiKeyUserId: null, apiKeyId: "apikey_1" })),
      ).toEqual({ type: "system", id: "apikey:apikey_1" });
    });
  });

  describe("when the request carries neither a user nor a key id", () => {
    it("attributes the write to the management API rather than to apikey:undefined", () => {
      const actor = orgRequestLedgerActor(contextWith({}));

      expect(actor).toEqual({ type: "system", id: "system:management-api" });
      expect(actor.id).not.toContain("undefined");
    });

    it("treats an empty key id the same way", () => {
      expect(
        orgRequestLedgerActor(contextWith({ apiKeyUserId: null, apiKeyId: "" })),
      ).toEqual({ type: "system", id: "system:management-api" });
    });
  });
});
