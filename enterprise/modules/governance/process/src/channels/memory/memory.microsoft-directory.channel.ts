// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { peopleRefused, type PeopleListing } from "../../rules/people-listing.rules.ts";
import type {
  MicrosoftDirectoryChannel,
  MicrosoftDirectoryRead,
} from "../microsoft-directory.channel.ts";

/** The directory in memory: a tenant answers what a test seeded, and one nothing seeded is unreachable. */
export class MemoryMicrosoftDirectoryChannel implements MicrosoftDirectoryChannel {
  readonly asked: string[] = [];
  private read: MicrosoftDirectoryRead | undefined;
  private listing: PeopleListing | undefined;

  private constructor() {}

  static create(): MemoryMicrosoftDirectoryChannel {
    return new MemoryMicrosoftDirectoryChannel();
  }

  seedRead({ read }: { read: MicrosoftDirectoryRead }): void {
    this.read = read;
  }

  seedListing({ listing }: { listing: PeopleListing }): void {
    this.listing = listing;
  }

  async readDirectory({ token }: { token: string }): Promise<MicrosoftDirectoryRead> {
    this.asked.push(token);
    if (this.read) return this.read;
    throw new Error("microsoft graph is unreachable in memory until a read is seeded");
  }

  async listPeople({ token }: { token: string }): Promise<PeopleListing> {
    this.asked.push(token);
    return this.listing ?? peopleRefused({ reason: "unreachable", status: null });
  }
}
