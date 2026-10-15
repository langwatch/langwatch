/**
 * The providers a deployment holds its own keys for (ADR-156 section 8): the
 * platform's own credentials, never written to `ModelProvider` because they are
 * not rows a customer owns. A peer dispatching on LangWatch's behalf asks here.
 */

import { modelProviders } from "./model-provider-registry.ts";

/** The id prefix a synthesized platform row carries, so it never collides with a stored one. */
export const PLATFORM_PROVIDER_ID_PREFIX = "platform-";

/** One provider of the chain: which provider, under which credential, and the credential. */
export type PlatformProviderEntry = {
  /** The registry key, e.g. `openai`. */
  provider: string;
  /** The credential's declared name, which is also the key of the credential bag. */
  credentialKey: string;
  credential: string;
};

/**
 * Every dispatchable provider this deployment could hold a key for, in registry
 * order. That is the dispatch order, and it is the registry's rather than the
 * credential record's, which would move whenever a deployment gained a key.
 */
export function platformProviderCredentialNames(): { provider: string; credentialKey: string }[] {
  return Object.entries(modelProviders)
    .filter(([, definition]) => definition.type === "llm")
    .map(([provider, definition]) => ({ provider, credentialKey: definition.apiKey }));
}

/**
 * The chain, given what the deployment resolved. A provider whose credential is
 * absent or blank is left out, so the chain never offers one that cannot
 * authenticate.
 */
export function platformProviderChainOf(
  credentials: Readonly<Record<string, string | undefined>>,
): PlatformProviderEntry[] {
  return platformProviderCredentialNames().flatMap(({ provider, credentialKey }) => {
    const credential = credentials[provider]?.trim();

    return credential ? [{ provider, credentialKey, credential }] : [];
  });
}
