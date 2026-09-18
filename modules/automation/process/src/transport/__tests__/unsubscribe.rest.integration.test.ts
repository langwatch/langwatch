/**
 * @vitest-environment node
 * Characterisation of `POST /api/unsubscribe` through the real REST runtime.
 */
import {
  UnsubscribeLinkInvalidError,
  UnsubscribeRateLimitedError,
  type AutomationApi,
} from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { mountUnsubscribeRest } from "./automation-rest.harness.ts";

type Accepted = Parameters<AutomationApi["acceptUnsubscribe"]>[0];

function mount(accept: (input: Accepted) => Promise<void>) {
  const spent: Accepted[] = [];

  return {
    spent,
    ...mountUnsubscribeRest({
      acceptUnsubscribe: async (input) => {
        spent.push(input);

        return accept(input);
      },
    }),
  };
}

describe("given the one-click unsubscribe door", () => {
  describe("when a mail client posts a valid token", () => {
    it("answers 200 and spends it against the trigger scope", async () => {
      const api = mount(async () => undefined);

      const response = await api.send("POST", "/api/unsubscribe?token=t_valid");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(api.spent).toEqual([
        { token: "t_valid", scope: "trigger", callerAddress: "10.0.0.1", via: "one-click" },
      ]);
    });
  });

  describe("when the link carries no token", () => {
    it("answers 400 without reaching the application", async () => {
      const api = mount(async () => undefined);

      const response = await api.send("POST", "/api/unsubscribe");

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Missing token" });
      expect(api.spent).toEqual([]);
    });
  });

  describe("when the token is tampered with", () => {
    it("answers 400, distinct from the 500 a write failure gets", async () => {
      const refusing = mount(async () => {
        throw new UnsubscribeLinkInvalidError("This unsubscribe link is invalid.", 400);
      });
      const broken = mount(async () => {
        throw new Error("connection reset");
      });

      const tampered = await refusing.send("POST", "/api/unsubscribe?token=t_bad");
      expect(tampered.status).toBe(400);
      await expect(tampered.json()).resolves.toEqual({ error: "Invalid token" });

      const failed = await broken.send("POST", "/api/unsubscribe?token=t_valid");
      expect(failed.status).toBe(500);
      await expect(failed.json()).resolves.toEqual({ error: "Internal server error" });
    });
  });

  describe("when the caller has already filled the window", () => {
    it("answers 429 in the body the mail client has always read", async () => {
      const api = mount(async () => {
        throw new UnsubscribeRateLimitedError();
      });

      const response = await api.send("POST", "/api/unsubscribe?token=t_valid");

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({ error: "Too many requests" });
    });
  });

  describe("when the method is anything but POST", () => {
    it("answers 405 with an Allow header rather than a bare 404", async () => {
      const api = mount(async () => undefined);

      const response = await api.send("GET", "/api/unsubscribe?token=t_valid");

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      await expect(response.json()).resolves.toEqual({ error: "Method not allowed" });
      expect(api.spent).toEqual([]);
    });
  });
});
