/**
 * The pull request link store, run the same way over native Redis and the memory twin: links,
 * the once-per-commit wake claim, and the follow-up count a person's turn resets.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testRedisUrl } from "../../__tests__/support/test-redis-url.ts";
import type { LangyPullRequestLinkRepository } from "../langy-pull-request-link.repository.ts";
import { LangyPullRequestLinkMemoryRepository } from "../memory/memory.langy-pull-request-link.repository.ts";
import { LangyPullRequestLinkRedisRepository } from "../redis/redis.langy-pull-request-link.repository.ts";

const REDIS_URL = testRedisUrl();
let redis: Redis | undefined;

beforeAll(() => {
  if (REDIS_URL) redis = new IORedis(REDIS_URL);
});

afterAll(async () => {
  await redis?.quit();
});

const backings: [string, () => LangyPullRequestLinkRepository][] = [
  ["memory", () => LangyPullRequestLinkMemoryRepository.create()],
  ...(REDIS_URL
    ? [
        ["redis", () => LangyPullRequestLinkRedisRepository.create({ redis: redis! })] as [
          string,
          () => LangyPullRequestLinkRepository,
        ],
      ]
    : []),
];

/** A repository name no other run shares, so tests on one Redis never see each other's keys. */
function freshPullRequest() {
  return { repositoryFullName: `Acme/agent-${randomUUID()}`, prNumber: 12 };
}

describe.each(backings)("the pull request link store over %s", (_backing, open) => {
  it("finds a link by the repository name in any case", async () => {
    const links = open();
    const key = freshPullRequest();
    const link = {
      ...key,
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: `conversation-${randomUUID()}`,
      userId: "user-1",
      linkedAt: 1,
    };

    await links.link(link);

    expect(
      await links.findLinks({ ...key, repositoryFullName: key.repositoryFullName.toLowerCase() }),
    ).toEqual([link]);
    expect(await links.findLinks({ ...key, prNumber: 13 })).toEqual([]);
  });

  it("claims a commit's wake once, and again only after it was released", async () => {
    const links = open();
    const wake = { ...freshPullRequest(), headSha: "abc123" };

    expect(await links.claimWake(wake)).toBe(true);
    expect(await links.claimWake(wake)).toBe(false);
    await links.releaseWake(wake);
    expect(await links.claimWake(wake)).toBe(true);
  });

  it("counts follow-ups, remembers their turns and resets them for the conversation", async () => {
    const links = open();
    const key = freshPullRequest();
    const conversationId = `conversation-${randomUUID()}`;
    await links.link({
      ...key,
      organizationId: "org-1",
      projectId: "project-1",
      conversationId,
      userId: "user-1",
      linkedAt: 1,
    });

    expect(await links.recordFollowUp({ ...key, conversationId, turnId: "turn-1" })).toBe(1);
    expect(await links.recordFollowUp({ ...key, conversationId, turnId: "turn-2" })).toBe(2);
    expect(await links.isFollowUpTurn({ conversationId, turnId: "turn-2" })).toBe(true);
    expect(await links.isFollowUpTurn({ conversationId, turnId: "turn-3" })).toBe(false);

    await links.resetFollowUps({ conversationId });

    expect(await links.countFollowUps(key)).toBe(0);
  });
});
