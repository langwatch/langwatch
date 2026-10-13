/**
 * @vitest-environment node
 * Google and GitHub hard-wire their hosts in Better Auth; the plugin points them at a base.
 */
import { github, google } from "better-auth/social-providers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { socialProviderBasesPlugin } from "../http.social-provider-bases.channel.ts";

const NO_BASES = { google: undefined, github: undefined, gitlab: undefined, microsoft: undefined };
const CREDENTIALS = { clientId: "id", clientSecret: "secret" };
const GITHUB_BASE = "http://idp.test/t/1/social/github";
const GOOGLE_BASE = "http://idp.test/t/1/social/google";

type Provider = Parameters<
  NonNullable<ReturnType<typeof socialProviderBasesPlugin>["init"]>
>[0]["socialProviders"][number];

async function mounted(bases: Partial<Record<"google" | "github", string>>): Promise<Provider[]> {
  const plugin = socialProviderBasesPlugin({ bases: { ...NO_BASES, ...bases } });
  const providers = [google(CREDENTIALS), github(CREDENTIALS)];
  const result = await plugin.init?.({ socialProviders: providers } as never);
  return (result as { context: { socialProviders: Provider[] } }).context.socialProviders;
}

async function link(provider: Provider | undefined): Promise<URL> {
  return provider!.createAuthorizationURL({
    state: "s",
    codeVerifier: "v".repeat(43),
    redirectURI: "http://app.test/api/auth/callback/x",
  });
}

afterEach(() => vi.restoreAllMocks());

describe("given no sign-in base is set", () => {
  /** @scenario A social provider reaches the real host unless a base is set */
  it("builds links on the real google and github hosts", async () => {
    const [googleProvider, githubProvider] = await mounted({});
    expect((await link(googleProvider)).origin).toBe("https://accounts.google.com");
    expect((await link(githubProvider)).origin).toBe("https://github.com");
  });
});

describe("given a sign-in base for google and github", () => {
  /** @scenario A social provider reaches the base a deployment names */
  it("sends the browser link to the base", async () => {
    const [googleProvider, githubProvider] = await mounted({
      google: GOOGLE_BASE,
      github: `${GITHUB_BASE}/`,
    });
    expect((await link(googleProvider)).href).toMatch(`${GOOGLE_BASE}/o/oauth2/v2/auth?`);
    expect((await link(githubProvider)).href).toMatch(`${GITHUB_BASE}/login/oauth/authorize?`);
  });

  /** @scenario A social provider reaches the base a deployment names */
  it("exchanges the github code and reads the user from the base", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(url);
      if (url.endsWith("/access_token")) return Response.json({ access_token: "tok" });
      if (url.endsWith("/user/emails")) {
        return Response.json([{ email: "a@b.test", primary: true, verified: true }]);
      }
      return Response.json({ id: 7, login: "ada", avatar_url: "http://img" });
    });
    const [, githubProvider] = await mounted({ github: GITHUB_BASE });

    const tokens = await githubProvider!.validateAuthorizationCode({
      code: "c",
      redirectURI: "http://app.test/cb",
    });
    const info = await githubProvider!.getUserInfo(tokens!);

    expect(info?.user).toMatchObject({ email: "a@b.test", emailVerified: true, name: "ada" });
    expect(calls).toEqual([
      `${GITHUB_BASE}/login/oauth/access_token`,
      `${GITHUB_BASE}/user`,
      `${GITHUB_BASE}/user/emails`,
    ]);
  });

  /** @scenario A social provider reaches the base a deployment names */
  it("exchanges the google code at the base's token endpoint", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(input instanceof Request ? input.url : input.toString());
      return Response.json({ access_token: "tok", id_token: "x" });
    });
    const [googleProvider] = await mounted({ google: GOOGLE_BASE });

    await googleProvider!.validateAuthorizationCode({
      code: "c",
      codeVerifier: "v",
      redirectURI: "http://app.test/cb",
    });

    expect(urls[0]).toBe(`${GOOGLE_BASE}/token`);
  });
});
