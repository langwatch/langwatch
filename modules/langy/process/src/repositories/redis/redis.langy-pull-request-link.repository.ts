import type { Redis } from "ioredis";
import { z } from "zod";

import { pullRequestKeyOf } from "../../rules/langy-ci-follow-up.rules.ts";
import {
  LANGY_PULL_REQUEST_LINK_TTL_SECONDS,
  type LangyPullRequestKey,
  type LangyPullRequestLink,
  LangyPullRequestLinkRepository,
} from "../langy-pull-request-link.repository.ts";

/** The Redis surface the links need. */
export type LangyPullRequestLinkRedis = Pick<
  Redis,
  "hset" | "hvals" | "set" | "get" | "del" | "incr" | "expire" | "sadd" | "smembers" | "sismember"
>;

const linkSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  conversationId: z.string(),
  userId: z.string(),
  repositoryFullName: z.string(),
  prNumber: z.number().int().positive(),
  linkedAt: z.number(),
});

const linksKey = (key: string) => `langy:ci:pr:${key}:links`;
const followUpsKey = (key: string) => `langy:ci:pr:${key}:follow-ups`;
const wakeKey = (key: string, headSha: string) => `langy:ci:pr:${key}:wake:${headSha}`;
const conversationLinksKey = (conversationId: string) =>
  `langy:ci:conversation:${conversationId}:prs`;
const conversationTurnsKey = (conversationId: string) =>
  `langy:ci:conversation:${conversationId}:follow-up-turns`;

/** A stored link that is not JSON, or not a link, reads as none. */
function parseLink(raw: string): LangyPullRequestLink[] {
  try {
    const parsed = linkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

export class LangyPullRequestLinkRedisRepository extends LangyPullRequestLinkRepository {
  static create({
    redis,
  }: {
    redis: LangyPullRequestLinkRedis;
  }): LangyPullRequestLinkRedisRepository {
    return new LangyPullRequestLinkRedisRepository(redis);
  }

  private constructor(private readonly redis: LangyPullRequestLinkRedis) {
    super();
  }

  async link(link: LangyPullRequestLink): Promise<void> {
    const key = pullRequestKeyOf(link);
    await this.redis.hset(linksKey(key), link.conversationId, JSON.stringify(link));
    await this.redis.expire(linksKey(key), LANGY_PULL_REQUEST_LINK_TTL_SECONDS);
    await this.redis.sadd(conversationLinksKey(link.conversationId), key);
    await this.redis.expire(
      conversationLinksKey(link.conversationId),
      LANGY_PULL_REQUEST_LINK_TTL_SECONDS,
    );
  }

  async findLinks(key: LangyPullRequestKey): Promise<LangyPullRequestLink[]> {
    const raws = await this.redis.hvals(linksKey(pullRequestKeyOf(key)));
    return raws.flatMap(parseLink);
  }

  async claimWake(key: LangyPullRequestKey & { headSha: string }): Promise<boolean> {
    const claimed = await this.redis.set(
      wakeKey(pullRequestKeyOf(key), key.headSha),
      "1",
      "EX",
      LANGY_PULL_REQUEST_LINK_TTL_SECONDS,
      "NX",
    );
    return claimed === "OK";
  }

  async releaseWake(key: LangyPullRequestKey & { headSha: string }): Promise<void> {
    await this.redis.del(wakeKey(pullRequestKeyOf(key), key.headSha));
  }

  async countFollowUps(key: LangyPullRequestKey): Promise<number> {
    const raw = await this.redis.get(followUpsKey(pullRequestKeyOf(key)));
    return raw ? Number.parseInt(raw, 10) || 0 : 0;
  }

  async recordFollowUp(
    key: LangyPullRequestKey & { conversationId: string; turnId: string },
  ): Promise<number> {
    const counter = followUpsKey(pullRequestKeyOf(key));
    const count = await this.redis.incr(counter);
    await this.redis.expire(counter, LANGY_PULL_REQUEST_LINK_TTL_SECONDS);
    await this.redis.sadd(conversationTurnsKey(key.conversationId), key.turnId);
    await this.redis.expire(
      conversationTurnsKey(key.conversationId),
      LANGY_PULL_REQUEST_LINK_TTL_SECONDS,
    );
    return count;
  }

  async isFollowUpTurn(input: { conversationId: string; turnId: string }): Promise<boolean> {
    return (
      (await this.redis.sismember(conversationTurnsKey(input.conversationId), input.turnId)) === 1
    );
  }

  async resetFollowUps(input: { conversationId: string }): Promise<void> {
    const keys = await this.redis.smembers(conversationLinksKey(input.conversationId));
    if (keys.length === 0) return;
    await this.redis.del(...keys.map(followUpsKey));
  }
}
