import { describe, expect, it } from "vitest";

import { isMintedFromHttpCredential, originToBind } from "../http-secret-binding.rules.ts";

describe("binding an existing HTTP secret", () => {
  /** @scenario "The backfill binds each HTTP secret to the one address that sends it" */
  it("binds to the one origin every call sends the secret to", () => {
    expect(originToBind(new Set(["https://a.example"]))).toBe("https://a.example");
  });

  /** @scenario "The backfill binds each HTTP secret to the one address that sends it" */
  it.each([
    ["two origins", ["https://a.example", "https://b.example"]],
    ["an address with no fixed origin", ["https://a.example", ""]],
    ["no call at all", []],
  ])("binds nothing for %s", (_case, origins) => {
    expect(originToBind(new Set(origins))).toBeUndefined();
  });

  it("binds only secrets minted from an HTTP credential", () => {
    expect(isMintedFromHttpCredential("HTTP_AGENT_AUTH_TOKEN")).toBe(true);
    expect(isMintedFromHttpCredential("PARTNER_TOKEN")).toBe(false);
  });
});
