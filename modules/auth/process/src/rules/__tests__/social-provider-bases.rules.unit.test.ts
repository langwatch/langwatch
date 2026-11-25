/**
 * @vitest-environment node
 * Which hosts a social provider is reached on: the real one unless a base is set.
 */
import { describe, expect, it } from "vitest";

import {
  rebaseUrl,
  trimSocialBase,
  withSocialProviderBases,
} from "../social-provider-bases.rules.ts";

const NO_BASES = { google: undefined, github: undefined, gitlab: undefined, microsoft: undefined };
const PROVIDERS = {
  gitlab: { clientId: "l", clientSecret: "s" },
  microsoft: { clientId: "m", clientSecret: "s", tenantId: "t" },
};

describe("given no base is set for a social provider", () => {
  /** @scenario A social provider reaches the real host unless a base is set */
  it("leaves every provider's options as they were", () => {
    expect(withSocialProviderBases({ providers: PROVIDERS, bases: NO_BASES })).toEqual(PROVIDERS);
    expect(trimSocialBase("  ")).toBe("");
  });
});

describe("given a base is set for gitlab and microsoft", () => {
  /** @scenario A social provider reaches the base a deployment names */
  it("gives gitlab its issuer and microsoft its authority", () => {
    const providers = withSocialProviderBases({
      providers: PROVIDERS,
      bases: { ...NO_BASES, gitlab: "http://idp/t/1/social/gitlab/", microsoft: "http://idp/m" },
    });
    expect(providers.gitlab).toMatchObject({ issuer: "http://idp/t/1/social/gitlab" });
    expect(providers.microsoft).toMatchObject({ authority: "http://idp/m", tenantId: "t" });
  });

  it("does not mount a provider the deployment did not configure", () => {
    const providers = withSocialProviderBases({
      providers: {},
      bases: { ...NO_BASES, gitlab: "http://idp/g" },
    });
    expect(providers).toEqual({});
  });
});

describe("given a url on the real provider's origin", () => {
  it("swaps the origin for the base and leaves other urls alone", () => {
    const from = "https://github.com";
    const swapped = rebaseUrl({
      url: new URL("https://github.com/login/oauth/authorize?a=1"),
      from,
      base: "http://idp/t/1/social/github",
    });
    expect(swapped.href).toBe("http://idp/t/1/social/github/login/oauth/authorize?a=1");
    const other = new URL("https://elsewhere.test/x");
    expect(rebaseUrl({ url: other, from, base: "http://idp" })).toBe(other);
  });
});
