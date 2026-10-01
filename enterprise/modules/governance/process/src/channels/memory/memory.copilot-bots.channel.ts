// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentListing,
  type AgentListingRefusal,
  agentsRefused,
} from "../../rules/agent-listing.rules.ts";
import type { CopilotBotsChannel, CopilotBotsRead } from "../copilot-bots.channel.ts";

const UNREACHABLE: AgentListingRefusal = { reason: "unreachable", status: null };

/** The `bot` table in memory: an environment answers what a test seeded, and one nothing seeded is unreachable. */
export class MemoryCopilotBotsChannel implements CopilotBotsChannel {
  readonly asked: string[] = [];
  private readonly reads = new Map<string, CopilotBotsRead>();
  private readonly listings = new Map<string, AgentListing>();

  private constructor() {}

  static create(): MemoryCopilotBotsChannel {
    return new MemoryCopilotBotsChannel();
  }

  seedRead({ environmentUrl, read }: { environmentUrl: string; read: CopilotBotsRead }): void {
    this.reads.set(environmentUrl, read);
  }

  seedListing({
    environmentUrl,
    listing,
  }: {
    environmentUrl: string;
    listing: AgentListing;
  }): void {
    this.listings.set(environmentUrl, listing);
  }

  async readBots({ environmentUrl }: { environmentUrl: string }): Promise<CopilotBotsRead> {
    this.asked.push(environmentUrl);
    return this.reads.get(environmentUrl) ?? { ok: false, refusal: UNREACHABLE };
  }

  async listAgents({ environmentUrl }: { environmentUrl: string }): Promise<AgentListing> {
    this.asked.push(environmentUrl);
    return this.listings.get(environmentUrl) ?? agentsRefused(UNREACHABLE);
  }
}
