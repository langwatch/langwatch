// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { IngestionCredentialsService } from "../../services/ingestion-credentials.service.ts";
import { ProviderAccountChannel } from "../provider-account.channel.ts";

/**
 * A twin with no provider behind it: it answers from the keys it was given, read off
 * `credentials.token` (a sealed envelope opened) as the live channel reads them, and refuses any
 * other key as a provider would.
 */
export class MemoryProviderAccountChannel extends ProviderAccountChannel {
  readonly asked: { sourceType: string; parserConfig: Record<string, unknown> }[] = [];

  private constructor(
    private readonly accountsByKey: ReadonlyMap<string, string>,
    private readonly credentials: Pick<IngestionCredentialsService, "decrypt"> | undefined,
  ) {
    super();
  }

  static create(
    options: {
      accountsByKey?: Record<string, string>;
      credentials?: Pick<IngestionCredentialsService, "decrypt">;
    } = {},
  ): MemoryProviderAccountChannel {
    return new MemoryProviderAccountChannel(
      new Map(Object.entries(options.accountsByKey ?? {})),
      options.credentials,
    );
  }

  async getAccountId(input: {
    sourceType: string;
    parserConfig: Record<string, unknown>;
  }): Promise<string> {
    this.asked.push(input);
    const raw = input.parserConfig.credentials;
    const opened = this.credentials?.decrypt(raw) ?? (raw && typeof raw === "object" ? raw : {});
    const token = "token" in opened ? opened.token : undefined;
    const account = typeof token === "string" ? this.accountsByKey.get(token) : undefined;
    if (account === undefined) {
      throw new Error("the provider does not recognise this administrator key");
    }

    return account;
  }
}
