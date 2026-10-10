import { createLogger } from "@langwatch/observability";

import { parseChangelogEntryPage, parseChangelogFeed } from "../../rules/user-changelog.rules.ts";
import { type UserChangelogEntry, UserChangelogChannel } from "../user-changelog.channel.ts";

const logger = createLogger("langwatch:user-changelog");

const FEED_URL = "https://langwatch.ai/changelog/rss.xml";
const FETCH_TIMEOUT_MS = 4_000;
const FRESH_MS = 24 * 60 * 60_000;
/** A failed read is retried sooner than a good one, but not on every page load. */
const RETRY_MS = 60 * 60_000;

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/**
 * Reads the feed and the latest entry's page at most once a day per process, with no cookie,
 * header or query that identifies the installation. Any failure answers empty, never throws.
 */
export class HttpUserChangelogChannel extends UserChangelogChannel {
  static create(input: {
    disabled: boolean;
    fetch?: Fetch;
    now?: () => number;
  }): HttpUserChangelogChannel {
    return new HttpUserChangelogChannel(
      input.disabled,
      input.fetch ?? fetch,
      input.now ?? Date.now,
    );
  }

  #read: { at: number; ttl: number; entries: Promise<UserChangelogEntry[]> } | undefined;

  private constructor(
    private readonly disabled: boolean,
    private readonly fetchUrl: Fetch,
    private readonly now: () => number,
  ) {
    super();
  }

  findLatestEntries(): Promise<UserChangelogEntry[]> {
    if (this.disabled) return Promise.resolve([]);
    const now = this.now();
    if (this.#read && now - this.#read.at < this.#read.ttl) return this.#read.entries;

    const read = { at: now, ttl: FRESH_MS, entries: Promise.resolve<UserChangelogEntry[]>([]) };
    read.entries = this.#fetchLatest().catch((error: unknown) => {
      read.ttl = RETRY_MS;
      logger.warn({ error }, "changelog unreachable; What's new stays hidden");
      return [];
    });
    this.#read = read;
    return read.entries;
  }

  async #fetchLatest(): Promise<UserChangelogEntry[]> {
    const [latest] = parseChangelogFeed(await this.#text(FEED_URL));
    if (!latest) throw new Error("changelog feed lists no entry");
    const detail = await this.#text(latest.url)
      .then((html) => parseChangelogEntryPage({ html, pageUrl: latest.url }))
      .catch(() => ({ imageUrl: null, features: [] }));
    return [{ ...latest, ...detail }];
  }

  async #text(url: string): Promise<string> {
    const response = await this.fetchUrl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`changelog answered ${response.status}`);
    return response.text();
  }
}
