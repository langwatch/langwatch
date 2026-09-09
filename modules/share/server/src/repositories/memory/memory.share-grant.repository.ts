import { nowInstant } from "@langwatch/time";
import type {
  ConsumeShareUsageParams,
  ShareGrantRepository,
  ShareGrantScope,
} from "../share-grant.repository.ts";
import { MemoryShareDatabase } from "./memory.share.database.ts";

export class MemoryShareGrantRepository implements ShareGrantRepository {
  #database: MemoryShareDatabase;

  private constructor(database: MemoryShareDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ memory: MemoryShareDatabase }>): MemoryShareGrantRepository {
    return new MemoryShareGrantRepository(input.memory);
  }

  async findAllResourceGrantIds({
    organizationId,
    projectId,
    id,
    resourceKind,
    resourceId,
  }: ShareGrantScope): Promise<string[]> {
    return this.#database.grants
      .filter(
        (grant) =>
          grant.organizationId === organizationId &&
          grant.projectId === projectId &&
          grant.revokedAt === null &&
          grant.scopeType === "RESOURCE" &&
          (id === void 0 || grant.id === id) &&
          (resourceKind === void 0 || grant.resourceKind === resourceKind) &&
          (resourceId === void 0 || grant.scopeId === resourceId),
      )
      .map((grant) => grant.id);
  }

  async consumeUsage({
    grantId,
    organizationId,
    projectId,
    maxViews,
  }: ConsumeShareUsageParams): Promise<boolean> {
    const capped = maxViews != null;
    const usage = this.#database.usages.find(
      (row) =>
        row.grantId === grantId &&
        row.organizationId === organizationId &&
        row.projectId === projectId,
    );

    if (usage) {
      if (capped && usage.viewCount >= maxViews) return false;
      usage.viewCount += 1;
      usage.lastViewedAt = nowInstant();
      this.#mirror({ grantId, projectId, maxViews });

      return true;
    }

    // A non-positive cap must not enter through the first-view create.
    if (capped && maxViews <= 0) return false;

    this.#database.usages.push({
      grantId,
      organizationId,
      projectId,
      viewCount: 1,
      lastViewedAt: nowInstant(),
    });
    this.#mirror({ grantId, projectId, maxViews });

    return true;
  }

  /** The compatible row is a mirror: an exhausted or missing one is not a failure. */
  #mirror({
    grantId,
    projectId,
    maxViews,
  }: {
    grantId: string;
    projectId: string;
    maxViews: number | null;
  }): void {
    const link = this.#database.link(grantId, projectId);
    if (!link) return;
    if (maxViews != null && link.viewCount >= maxViews) return;

    link.viewCount += 1;
  }
}
