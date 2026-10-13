import type { SocialProviderBases } from "@langwatch/auth-contract";
import type { BetterAuthPlugin } from "better-auth";
import {
  authorizationCodeRequest,
  getOAuth2Tokens,
  validateAuthorizationCode,
} from "better-auth/oauth2";

import { rebaseUrl, trimSocialBase } from "../../rules/social-provider-bases.rules.ts";

type InitContext = Parameters<NonNullable<BetterAuthPlugin["init"]>>[0];
type SocialProvider = InitContext["socialProviders"][number];

const GOOGLE_ACCOUNTS = "https://accounts.google.com";
const GITHUB_WEB = "https://github.com";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Better Auth's Google and GitHub providers hard-wire their hosts, so when a base is set for
 * one the mounted provider is replaced by the same provider speaking to that base. Unset, the
 * provider is untouched. GitLab and Microsoft take their base as options instead.
 */
export function socialProviderBasesPlugin({
  bases,
}: {
  bases: Partial<SocialProviderBases>;
}): BetterAuthPlugin {
  return {
    id: "social-provider-bases",
    init: (ctx) => ({
      context: {
        socialProviders: ctx.socialProviders.map((provider) => {
          const google = trimSocialBase(bases.google);
          const github = trimSocialBase(bases.github);
          if (provider.id === "google" && google) return googleAt({ provider, base: google });
          if (provider.id === "github" && github) return githubAt({ provider, base: github });
          return provider;
        }),
      },
    }),
  };
}

function googleAt({ provider, base }: { provider: SocialProvider; base: string }): SocialProvider {
  return {
    ...provider,
    createAuthorizationURL: async (input) =>
      rebaseUrl({
        url: await provider.createAuthorizationURL(input),
        from: GOOGLE_ACCOUNTS,
        base,
      }),
    validateAuthorizationCode: ({ code, codeVerifier, redirectURI }) =>
      validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI,
        options: provider.options ?? {},
        tokenEndpoint: `${base}/token`,
      }),
  };
}

function githubAt({ provider, base }: { provider: SocialProvider; base: string }): SocialProvider {
  return {
    ...provider,
    createAuthorizationURL: async (input) =>
      rebaseUrl({ url: await provider.createAuthorizationURL(input), from: GITHUB_WEB, base }),
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
      const { body, headers } = await authorizationCodeRequest({
        code,
        codeVerifier,
        redirectURI,
        options: provider.options ?? {},
      });
      const response = await fetch(`${base}/login/oauth/access_token`, {
        method: "POST",
        body,
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return "error" in data ? null : getOAuth2Tokens(data);
    },
    getUserInfo: async (token) => {
      if (provider.options?.getUserInfo) return provider.options.getUserInfo(token);
      const headers = { "User-Agent": "better-auth", authorization: `Bearer ${token.accessToken}` };
      const profileResponse = await fetch(`${base}/user`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!profileResponse.ok) return null;
      const profile = await profileResponse.json();
      const emailsResponse = await fetch(`${base}/user/emails`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const emails: { email: string; primary?: boolean; verified?: boolean }[] | null =
        emailsResponse.ok ? await emailsResponse.json() : null;
      if (!profile.email && emails) {
        profile.email = (emails.find((entry) => entry.primary) ?? emails[0])?.email;
      }
      const emailVerified =
        emails?.find((entry) => entry.email === profile.email)?.verified ?? false;
      const mapped = await provider.options?.mapProfileToUser?.(profile);
      return {
        user: {
          name: profile.name || profile.login || "",
          email: profile.email,
          image: profile.avatar_url,
          emailVerified,
          ...mapped,
        },
        data: profile,
      };
    },
  };
}
