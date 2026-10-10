// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { signInMethodLinkingCapability } from "../sign-in-method-linking-capability.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("linking another sign-in method, as auth lends it", () => {
  it("asks /link-social to return to the page the link started from", async () => {
    window.history.replaceState(null, "", "/me/security?tab=methods#linked");
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ redirect: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await signInMethodLinkingCapability.link({ provider: "github" })).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/link-social");
    const sent = typeof init?.body === "string" ? init.body : "";
    expect(JSON.parse(sent)).toEqual({
      provider: "github",
      callbackURL: "/me/security?tab=methods#linked",
    });
  });
});
