import type { UserWhatsNewEntry } from "@langwatch/user-contract";

import type { UserChangelogChannel } from "../channels/user-changelog.channel.ts";
import type { UserRepository } from "../repositories/user.repository.ts";

/** The changelog's latest entry, and which one each person last opened. */
export class UserWhatsNewService {
  static create(input: {
    changelog: UserChangelogChannel;
    users: Pick<UserRepository, "hasSeenWhatsNewEntry" | "setWhatsNewSeenEntry">;
  }): UserWhatsNewService {
    return new UserWhatsNewService(input.changelog, input.users);
  }

  private constructor(
    private readonly changelog: UserChangelogChannel,
    private readonly users: Pick<UserRepository, "hasSeenWhatsNewEntry" | "setWhatsNewSeenEntry">,
  ) {}

  async findWhatsNew(input: { id: string }): Promise<UserWhatsNewEntry[]> {
    const entries = await this.changelog.findLatestEntries();
    return Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        seen: await this.users.hasSeenWhatsNewEntry({ id: input.id, entryId: entry.id }),
      })),
    );
  }

  markWhatsNewSeen(input: { id: string; entryId: string }): Promise<void> {
    return this.users.setWhatsNewSeenEntry(input);
  }
}
