import { type UserChangelogEntry, UserChangelogChannel } from "../user-changelog.channel.ts";

/** Answers the entries a test hands it and calls nothing. */
export class MemoryUserChangelogChannel extends UserChangelogChannel {
  static create(input: { entries?: UserChangelogEntry[] } = {}): MemoryUserChangelogChannel {
    return new MemoryUserChangelogChannel(input.entries ?? []);
  }

  private constructor(private readonly entries: UserChangelogEntry[]) {
    super();
  }

  async findLatestEntries(): Promise<UserChangelogEntry[]> {
    return this.entries;
  }
}
