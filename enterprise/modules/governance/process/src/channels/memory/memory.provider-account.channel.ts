// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { credentialsOf } from "../../rules/ingestion-credentials.rules.ts";
import { ProviderAccountChannel } from "../provider-account.channel.ts";

/**
 * A twin with no provider behind it: it answers from the keys it was given, read off
 * `credentials.token` as the live channel reads them, and refuses any
 * other key as a provider would.
 */
export class MemoryProviderAccountChannel extends ProviderAccountChannel {
  readonly asked: { sourceType: string; parserConfig: Record<string, unknown> }[] = [];

  private constructor(private readonly accountsByKey: ReadonlyMap<string, string>) {
    super();
  }

  static create(
    options: { accountsByKey?: Record<string, string> } = {},
  ): MemoryProviderAccountChannel {
    return new MemoryProviderAccountChannel(new Map(Object.entries(options.accountsByKey ?? {})));
  }

  async getAccountId(input: {
    sourceType: string;
    parserConfig: Record<string, unknown>;
  }): Promise<string> {
    this.asked.push(input);
    const opened = credentialsOf(input.parserConfig.credentials);
    const token = "token" in opened ? opened.token : undefined;
    const account = typeof token === "string" ? this.accountsByKey.get(token) : undefined;
    if (account === undefined) {
      throw new Error("the provider does not recognise this administrator key");
    }

    return account;
  }
}
