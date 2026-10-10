// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The provider, answering which account an administrator key belongs to. A message to a vendor
 * this module does not own, so a channel; `http/` asks the provider, `memory/` answers from a map.
 */
export abstract class ProviderAccountChannel {
  abstract getAccountId(input: {
    sourceType: string;
    parserConfig: Record<string, unknown>;
  }): Promise<string>;
}
