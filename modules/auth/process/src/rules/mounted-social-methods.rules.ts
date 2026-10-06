import {
  findConfiguredSocialProviders,
  MICROSOFT_LEGACY_CALLBACK_ID,
  MICROSOFT_PROVIDER_CALLBACK_ID,
  type SocialProviderConfiguration,
} from "@langwatch/enterprise-sso-contract/sign-in-providers";

/**
 * The social providers better-auth mounted, by the id the rail dials, in rail order: read off
 * the same configuration the mounts are built from, so the door never offers an unmounted one.
 */
export function mountedSocialMethodIds({
  configuration,
}: {
  configuration: SocialProviderConfiguration;
}): string[] {
  return findConfiguredSocialProviders(configuration).map(({ key }) =>
    key === MICROSOFT_PROVIDER_CALLBACK_ID ? MICROSOFT_LEGACY_CALLBACK_ID : key,
  );
}
