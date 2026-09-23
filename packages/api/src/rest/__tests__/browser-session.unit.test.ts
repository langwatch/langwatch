import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { BrowserSessionIdentity } from "../browser-session.ts";
import { SessionReader } from "../credential.ts";

describe("browser session identity", () => {
  it("refuses cross-origin writes before looking up a session", async () => {
    const verify = vi.fn(async () => ({ userId: "user-1" }));

    const identity = BrowserSessionIdentity.create(
      SessionReader.create({ verify }),
      createApiFixture<AuthzApi>(),
    );

    const request = new Request("https://app.example/execute", {
      method: "POST",
      headers: { origin: "https://other.example" },
    });

    await expect(identity.identify({ request })).rejects.toMatchObject({
      code: "cross_origin_refused",
    });

    expect(verify).not.toHaveBeenCalled();
  });

  it("authorizes the parsed target for the signed-in user", async () => {
    const getDecision = vi.fn<AuthzApi["getDecision"]>(async () => ({
      permitted: false,
      organizationRole: null,
    }));

    const identity = BrowserSessionIdentity.create(
      SessionReader.create({ verify: async () => ({ userId: "user-1" }) }),
      createApiFixture<AuthzApi>({ getDecision }),
    );

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
    const identity = BrowserSessionIdentity.create(
      SessionReader.unverified(),
      createApiFixture<AuthzApi>(),
    );

    const request = new Request("https://app.example/consent");
    expect(await identity.identifyOptional({ request })).toBeNull();
    await expect(identity.identify({ request })).rejects.toMatchObject({ httpStatus: 401 });
  });
});
