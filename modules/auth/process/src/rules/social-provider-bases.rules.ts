import type { SocialProviderBases } from "@langwatch/auth-contract";
import type { BetterAuthOptions } from "better-auth";

/** A configured base without its trailing slashes; empty when none is set. */
export function trimSocialBase(base: string | undefined): string {
  const trimmed = base?.trim().replace(/\/+$/, "");
  return trimmed ?? "";
}

/** The URL with its leading real-provider origin swapped for `base`; any other URL is unchanged. */
export function rebaseUrl({ url, from, base }: { url: URL; from: string; base: string }): URL {
  return url.href.startsWith(from) ? new URL(base + url.href.slice(from.length)) : url;
}

type SocialProviders = NonNullable<BetterAuthOptions["socialProviders"]>;

/**
 * GitLab takes its host as `issuer` and Microsoft as `authority`, so those two need only their
 * option set; Google and GitHub hard-wire theirs and are redirected by the plugin.
 */
export function withSocialProviderBases({
  providers,
  bases,
}: {
  providers: SocialProviders;
  bases: Partial<SocialProviderBases>;
}): SocialProviders {
  const gitlab = trimSocialBase(bases.gitlab);
  const microsoft = trimSocialBase(bases.microsoft);
  const { gitlab: gitlabOptions, microsoft: microsoftOptions } = providers;
  return {
    ...providers,
    ...(gitlab && gitlabOptions && typeof gitlabOptions === "object"
      ? { gitlab: { ...gitlabOptions, issuer: gitlab } }
      : {}),
    ...(microsoft && microsoftOptions && typeof microsoftOptions === "object"
      ? { microsoft: { ...microsoftOptions, authority: microsoft } }
      : {}),
  };
}
