// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { peopleRefused, type PeopleListing } from "../../rules/people-listing.rules.ts";
import type { AdminApiUsersChannel } from "../admin-api-users.channel.ts";

type AdminApiProvider = "anthropic" | "openai";

/** The admin lists in memory: a provider answers what a test seeded, and one nothing seeded is unreachable. */
export class MemoryAdminApiUsersChannel implements AdminApiUsersChannel {
  readonly asked: { provider: AdminApiProvider; apiKey: string }[] = [];
  private readonly listings = new Map<AdminApiProvider, PeopleListing>();

  private constructor() {}

  static create(): MemoryAdminApiUsersChannel {
    return new MemoryAdminApiUsersChannel();
  }

  seed({ provider, listing }: { provider: AdminApiProvider; listing: PeopleListing }): void {
    this.listings.set(provider, listing);
  }

  async listAnthropicPeople({ apiKey }: { apiKey: string }): Promise<PeopleListing> {
    return this.answer({ provider: "anthropic", apiKey });
  }

  async listOpenAiPeople({ apiKey }: { apiKey: string }): Promise<PeopleListing> {
    return this.answer({ provider: "openai", apiKey });
  }

  private answer({
    provider,
    apiKey,
  }: {
    provider: AdminApiProvider;
    apiKey: string;
  }): PeopleListing {
    this.asked.push({ provider, apiKey });
    return this.listings.get(provider) ?? peopleRefused({ reason: "unreachable", status: null });
  }
}
