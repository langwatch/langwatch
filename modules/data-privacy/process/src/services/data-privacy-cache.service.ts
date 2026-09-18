import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";
import { nowInstant } from "@langwatch/time";
import {
  buildDataPrivacyChain,
  resolveDataPrivacy,
  type DataPrivacyScopeFacts,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";

type Entry = { value: ResolvedDataPrivacy; expiresAt: number };

export class DataPrivacyPolicyCacheService {
  static create(
    repository: DataPrivacyPolicyRepository,
    ttlMs = 60_000,
    now: () => number = () => nowInstant().epochMilliseconds,
  ): DataPrivacyPolicyCacheService {
    return new DataPrivacyPolicyCacheService(repository, ttlMs, now);
  }

  private readonly entries = new Map<string, Entry>();

  private constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = () => nowInstant().epochMilliseconds,
  ) {}

  async resolve(input: {
    projectId: string;
    facts: DataPrivacyScopeFacts;
  }): Promise<ResolvedDataPrivacy> {
    const cached = this.entries.get(input.projectId);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    this.entries.delete(input.projectId);
    const value = resolveDataPrivacy({
      rows: await this.repository.findForProjectChain({
        organizationId: input.facts.organizationId,
        scopes: buildDataPrivacyChain(input.facts),
      }),
      facts: input.facts,
    });
    this.entries.set(input.projectId, { value, expiresAt: this.now() + this.ttlMs });

    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
