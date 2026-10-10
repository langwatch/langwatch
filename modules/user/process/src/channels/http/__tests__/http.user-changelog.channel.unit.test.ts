/**
 * @vitest-environment node
 * The changelog is read at most once a day per process and fails soft.
 * @see modules/navigation/specs/whats-new.feature
 */
import { describe, expect, it } from "vitest";

import { HttpUserChangelogChannel } from "../http.user-changelog.channel.ts";

const ENTRY = "https://langwatch.ai/changelog/latest";
const FEED = `<rss><item><title>Latest</title><link>${ENTRY}</link></item></rss>`;
const PAGE = '<img src="/changelog/latest/01.png"><h2>What You Can Do Now</h2><h3>One</h3>';
const DAY = 24 * 60 * 60_000;

function channelOver(answer: (url: string) => Promise<Response>) {
  const calls: string[] = [];
  let clock = 0;
  const channel = HttpUserChangelogChannel.create({
    disabled: false,
    fetch: (url) => {
      calls.push(url);
      return answer(url);
    },
    now: () => clock,
  });
  return { channel, calls, advance: (ms: number) => (clock += ms) };
}

const pages = (url: string) => Promise.resolve(new Response(url.endsWith("rss.xml") ? FEED : PAGE));

describe("HttpUserChangelogChannel", () => {
  it("reads the latest entry with its screenshot and lines", async () => {
    const { channel } = channelOver(pages);
    expect(await channel.findLatestEntries()).toEqual([
      {
        id: ENTRY,
        title: "Latest",
        url: ENTRY,
        publishedAt: "",
        imageUrl: "https://langwatch.ai/changelog/latest/01.png",
        features: [{ text: "One", url: ENTRY }],
      },
    ]);
  });

  /** @scenario "The changelog is read at most once a day per process" */
  it("answers from its read for a day, then reads again", async () => {
    const { channel, calls, advance } = channelOver(pages);
    await channel.findLatestEntries();
    advance(DAY - 1);
    await channel.findLatestEntries();
    expect(calls).toHaveLength(2);
    advance(1);
    await channel.findLatestEntries();
    expect(calls).toHaveLength(4);
  });

  /** @scenario "The changelog cannot be reached" */
  it("answers empty when the feed fails, and does not retry on every call", async () => {
    const { channel, calls } = channelOver(() => Promise.reject(new Error("timeout")));
    expect(await channel.findLatestEntries()).toEqual([]);
    expect(await channel.findLatestEntries()).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("answers empty on an error status", async () => {
    const { channel } = channelOver(() => Promise.resolve(new Response("", { status: 503 })));
    expect(await channel.findLatestEntries()).toEqual([]);
  });

  /** @scenario "Air-gapped installations turn the changelog off" */
  it("never calls out when disabled", async () => {
    const calls: string[] = [];
    const channel = HttpUserChangelogChannel.create({
      disabled: true,
      fetch: (url) => {
        calls.push(url);
        return pages(url);
      },
    });
    expect(await channel.findLatestEntries()).toEqual([]);
    expect(calls).toEqual([]);
  });
});
