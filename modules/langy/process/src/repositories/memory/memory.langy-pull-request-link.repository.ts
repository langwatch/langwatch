import { pullRequestKeyOf } from "../../rules/langy-ci-follow-up.rules.ts";
import {
  type LangyPullRequestKey,
  type LangyPullRequestLink,
  LangyPullRequestLinkRepository,
} from "../langy-pull-request-link.repository.ts";

/** The pull request links in process memory; nothing lapses. */
export class LangyPullRequestLinkMemoryRepository extends LangyPullRequestLinkRepository {
  private readonly links = new Map<string, Map<string, LangyPullRequestLink>>();
  private readonly wakes = new Set<string>();
  private readonly followUps = new Map<string, number>();
  private readonly followUpTurns = new Set<string>();
  private readonly linkedByConversation = new Map<string, Set<string>>();

  static create(): LangyPullRequestLinkMemoryRepository {
    return new LangyPullRequestLinkMemoryRepository();
  }

  private constructor() {
    super();
  }

  link(link: LangyPullRequestLink): Promise<void> {
    const key = pullRequestKeyOf(link);
    const byConversation = this.links.get(key) ?? new Map<string, LangyPullRequestLink>();
    byConversation.set(link.conversationId, link);
    this.links.set(key, byConversation);
    const keys = this.linkedByConversation.get(link.conversationId) ?? new Set<string>();
    keys.add(key);
    this.linkedByConversation.set(link.conversationId, keys);
    return Promise.resolve();
  }

  findLinks(key: LangyPullRequestKey): Promise<LangyPullRequestLink[]> {
    return Promise.resolve([...(this.links.get(pullRequestKeyOf(key))?.values() ?? [])]);
  }

  claimWake(key: LangyPullRequestKey & { headSha: string }): Promise<boolean> {
    const wake = `${pullRequestKeyOf(key)}@${key.headSha}`;
    if (this.wakes.has(wake)) return Promise.resolve(false);
    this.wakes.add(wake);
    return Promise.resolve(true);
  }

  releaseWake(key: LangyPullRequestKey & { headSha: string }): Promise<void> {
    this.wakes.delete(`${pullRequestKeyOf(key)}@${key.headSha}`);
    return Promise.resolve();
  }

  countFollowUps(key: LangyPullRequestKey): Promise<number> {
    return Promise.resolve(this.followUps.get(pullRequestKeyOf(key)) ?? 0);
  }

  recordFollowUp(
    key: LangyPullRequestKey & { conversationId: string; turnId: string },
  ): Promise<number> {
    const count = (this.followUps.get(pullRequestKeyOf(key)) ?? 0) + 1;
    this.followUps.set(pullRequestKeyOf(key), count);
    this.followUpTurns.add(`${key.conversationId}:${key.turnId}`);
    return Promise.resolve(count);
  }

  isFollowUpTurn(input: { conversationId: string; turnId: string }): Promise<boolean> {
    return Promise.resolve(this.followUpTurns.has(`${input.conversationId}:${input.turnId}`));
  }

  resetFollowUps(input: { conversationId: string }): Promise<void> {
    for (const key of this.linkedByConversation.get(input.conversationId) ?? []) {
      this.followUps.delete(key);
    }
    return Promise.resolve();
  }
}
