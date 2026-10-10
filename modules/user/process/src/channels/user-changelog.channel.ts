import type { ChangelogEntryDetail, ChangelogFeedItem } from "../rules/user-changelog.rules.ts";

/** The public changelog's latest entry, with its screenshot and feature lines. */
export type UserChangelogEntry = ChangelogFeedItem & ChangelogEntryDetail;

/** The public weekly changelog at langwatch.ai; empty whenever it is off or unreachable. */
export abstract class UserChangelogChannel {
  abstract findLatestEntries(): Promise<UserChangelogEntry[]>;
}
