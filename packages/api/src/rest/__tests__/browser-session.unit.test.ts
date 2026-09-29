import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { BrowserSessionIdentity } from "../browser-session.ts";
import { SessionReader } from "../credential.ts";

const PUBLIC_BASE_URL = "https://app.example";
const INTERNAL_URL = "http://127.0.0.1:6560/api/export/scenario-runs/download";

function identityOver({ publicBaseUrl = PUBLIC_BASE_URL }: { publicBaseUrl?: string } = {}) {
  const verify = vi.fn(async () => ({ userId: "user-1" }));
  const identity = BrowserSessionIdentity.create({
    sessions: SessionReader.create({ verify }),
    authz: createApiFixture<AuthzApi>(),
    publicBaseUrl,
  });

  return { identity, verify };
}

function write(headers: Record<string, string>): Request {
  return new Request(INTERNAL_URL, { method: "POST", headers });
}

describe("browser session identity", () => {
  describe("given the API sits behind a proxy that hides the public address", () => {
    /** @scenario "A same-origin write through a proxy is accepted" */
    it("accepts a write whose Origin names the configured public base host", async () => {
      const { identity, verify } = identityOver();

      const caller = await identity.identify({
        request: write({ origin: PUBLIC_BASE_URL, host: "127.0.0.1:6560" }),
      });

      expect(caller.actor).toEqual({ type: "user", id: "user-1" });
      expect(verify).toHaveBeenCalledOnce();
    });

    /** @scenario "A same-origin write through a proxy is accepted" */
    it("accepts a write the browser marks same-origin, whatever the Origin says", async () => {
      const { identity } = identityOver({ publicBaseUrl: "https://elsewhere.example" });

      const caller = await identity.identify({
        request: write({ "sec-fetch-site": "same-origin", origin: PUBLIC_BASE_URL }),
      });

      expect(caller.actor).toEqual({ type: "user", id: "user-1" });
    });

    /** @scenario "A same-origin write through a proxy is accepted" */
    it("accepts a write whose Origin matches the forwarded host", async () => {
      const { identity } = identityOver({ publicBaseUrl: "https://elsewhere.example" });

      const caller = await identity.identify({
        request: write({ origin: PUBLIC_BASE_URL, "x-forwarded-host": "app.example" }),
      });

      expect(caller.actor).toEqual({ type: "user", id: "user-1" });
    });

    /** @scenario "A same-origin write through a proxy is accepted" */
    it("accepts a Referer-only write from the public base host", async () => {
      const { identity } = identityOver();

      const caller = await identity.identify({
        request: write({ referer: `${PUBLIC_BASE_URL}/project/scenarios` }),
      });

      expect(caller.actor).toEqual({ type: "user", id: "user-1" });
    });
  });

  describe("given a write that does not come from our own pages", () => {
    /** @scenario "A write from a foreign origin is refused" */
    it.each([
      ["a foreign Origin", { origin: "https://other.example" }],
      ["a foreign Referer", { referer: "https://other.example/page" }],
      ["a malformed Origin", { origin: "not a url" }],
      ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site", origin: PUBLIC_BASE_URL }],
    ])("refuses %s before looking up a session", async (_, headers) => {
      const { identity, verify } = identityOver();

      await expect(identity.identify({ request: write(headers) })).rejects.toMatchObject({
        code: "cross_origin_refused",
        httpStatus: 403,
      });

      expect(verify).not.toHaveBeenCalled();
    });

    /** @scenario "A write from a foreign origin is refused" */
    it("refuses a foreign Origin when no public base host is configured", async () => {
      const { identity } = identityOver({ publicBaseUrl: "" });

      await expect(
        identity.identify({ request: write({ origin: "https://other.example" }) }),
      ).rejects.toMatchObject({ code: "cross_origin_refused" });
    });

    /** @scenario "A write carrying neither an Origin nor a Referer is refused" */
    it("refuses a write with no Sec-Fetch-Site, Origin or Referer", async () => {
      const { identity, verify } = identityOver();

      await expect(
        identity.identify({ request: write({ host: "127.0.0.1:6560" }) }),
      ).rejects.toMatchObject({ code: "cross_origin_refused", httpStatus: 403 });

      expect(verify).not.toHaveBeenCalled();
    });
  });

  it("authorizes the parsed target for the signed-in user", async () => {
    const getDecision = vi.fn<AuthzApi["getDecision"]>(async () => ({
      permitted: false,
      organizationRole: null,
    }));

    const identity = BrowserSessionIdentity.create({
      sessions: SessionReader.create({ verify: async () => ({ userId: "user-1" }) }),
      authz: createApiFixture<AuthzApi>({ getDecision }),
      publicBaseUrl: void 0,
    });

    const caller = await identity.identify({
      request: new Request("https://app.example/execute", {
        method: "POST",
        headers: { origin: "https://app.example" },
      }),
    });

    const decision = await identity.authorize({
      caller,
      permission: "prompts:view",
      target: { tier: "project", id: "project-2" },
    });

    expect(decision.permitted).toBe(false);

    expect(getDecision).toHaveBeenCalledExactlyOnceWith({
      userId: "user-1",
      permission: "prompts:view",
      scope: { tier: "project", id: "project-2" },
    });
  });

  it("treats a missing session as absent only for optional authentication", async () => {
    const identity = BrowserSessionIdentity.create({
      sessions: SessionReader.unverified(),
      authz: createApiFixture<AuthzApi>(),
      publicBaseUrl: void 0,
    });

    const request = new Request("https://app.example/consent");
    expect(await identity.identifyOptional({ request })).toBeNull();
    await expect(identity.identify({ request })).rejects.toMatchObject({ httpStatus: 401 });
  });
});
