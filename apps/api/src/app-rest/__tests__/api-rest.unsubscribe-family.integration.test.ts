/**
 * @vitest-environment node
 * The one-click unsubscribe door, mounted the way this process mounts it
 * (RFC 8058, ADR-031).
 * @see specs/automations/unsubscribe-rest-api.feature
 */
import type { AutomationApp } from "@langwatch/automation-server";
import { describe, expect, it } from "vitest";

import { mountRestFamily } from "./support/rest-family.harness.ts";

describe("given a mail client posting to the one-click unsubscribe door", () => {
  describe("when the token is valid", () => {
    /** @scenario "A valid one-click token confirms the trigger-scoped unsubscribe" */
    it("answers 200 and spends the token against the trigger scope", async () => {
      const spent: { token: string; scope: string }[] = [];
      const automation = {
        acceptUnsubscribe: async (input: { token: string; scope: string }) =>
          void spent.push({ token: input.token, scope: input.scope }),
      } as unknown as AutomationApp;

      const api = mountRestFamily({ packaged: { automation: () => automation } });

      const response = await api.post("/api/unsubscribe?token=t_valid", undefined);

      expect(response.status).toBe(200);
      expect(spent).toEqual([{ token: "t_valid", scope: "trigger" }]);
    });
  });

  describe("when the link carries no token", () => {
    /** @scenario "A one-click link with no token is refused before it reaches the application" */
    it("answers 400 without reaching the application", async () => {
      const automation = {
        acceptUnsubscribe: async () => {
          throw new Error("must not be reached");
        },
      } as unknown as AutomationApp;

      const api = mountRestFamily({ packaged: { automation: () => automation } });

      const response = await api.post("/api/unsubscribe", undefined);

      expect(response.status).toBe(400);
    });
  });
});
