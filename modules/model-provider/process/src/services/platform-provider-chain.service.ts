/**
 * The providers this deployment holds its own keys for (ADR-156 section 8),
 * built one credential at a time so each resolved secret is closed over by the
 * service carrying it: the collaborator escapes the resolver, the value never.
 */

import {
  platformProviderChainOf,
  type PlatformProviderEntry,
} from "@langwatch/model-provider-contract";

export class PlatformProviderChainService {
  private constructor(private readonly credentials: Readonly<Record<string, string | undefined>>) {}

  /** A deployment that resolved nothing dispatches on customer credentials alone. */
  static create(): PlatformProviderChainService {
    return new PlatformProviderChainService({});
  }

  /** The same chain with one more provider's credential in it. */
  with(provider: string, credential: string | undefined): PlatformProviderChainService {
    return new PlatformProviderChainService({ ...this.credentials, [provider]: credential });
  }

  /** The chain in registry order, without the providers that have no credential. */
  chain(): PlatformProviderEntry[] {
    return platformProviderChainOf(this.credentials);
  }
}
