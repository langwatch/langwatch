import {
  buildDataPrivacyChain,
  resolveDataPrivacy,
  type DataPrivacyScopeFacts,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { nowInstant } from "@langwatch/time";

import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";

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
  /** Misses in flight, so concurrent reads of one project share one cascade walk (ADR-177). */
  private readonly inFlight = new Map<string, Promise<ResolvedDataPrivacy>>();

  private constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = () => nowInstant().epochMilliseconds,
  ) {}

  /** `facts` is read only on a miss: the ingest hot path reads placement once per window. */
  resolve(input: {
    projectId: string;
    facts: () => Promise<DataPrivacyScopeFacts>;
  }): Promise<ResolvedDataPrivacy> {
    const pending = this.inFlight.get(input.projectId);
    if (pending) return pending;
    const resolution = this.resolveUncoalesced(input).finally(() => {
      if (this.inFlight.get(input.projectId) === resolution) this.inFlight.delete(input.projectId);
    });
    this.inFlight.set(input.projectId, resolution);
    return resolution;
  }

  private async resolveUncoalesced(input: {
    projectId: string;
    facts: () => Promise<DataPrivacyScopeFacts>;
  }): Promise<ResolvedDataPrivacy> {
    const cached = this.entries.get(input.projectId);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    this.entries.delete(input.projectId);
    const facts = await input.facts();
    const value = resolveDataPrivacy({
      rows: await this.repository.findForProjectChain({
        organizationId: facts.organizationId,
        scopes: buildDataPrivacyChain(facts),
      }),
      facts,
    });
    this.entries.set(input.projectId, { value, expiresAt: this.now() + this.ttlMs });

    return value;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}
