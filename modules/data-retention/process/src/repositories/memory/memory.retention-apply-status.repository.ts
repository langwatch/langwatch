import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { RetentionApplyStatusState } from "../../eventing/retention-apply-status.projection.ts";
import type { ScopeApplyRecord } from "../../rules/stored-apply-status.rules.ts";
import type { RetentionApplyStatusRepository } from "../retention-apply-status.repository.ts";

/** The memory twin of `PrismaRetentionApplyStatusRepository`, keyed as the projection keys. */
export class MemoryRetentionApplyStatusRepository implements RetentionApplyStatusRepository {
  private readonly rows = new Map<string, StoredProjection<RetentionApplyStatusState>>();

  static create(): MemoryRetentionApplyStatusRepository {
    return new MemoryRetentionApplyStatusRepository();
  }

  private constructor() {}

  async get(key: string): Promise<StoredProjectionRead<RetentionApplyStatusState>> {
    const projection = this.rows.get(key);
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<RetentionApplyStatusState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.set(context.key ?? context.aggregateId, projection);
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ScopeApplyRecord[]> {
    return [...this.rows.values()]
      .map(({ state }) => state)
      .filter((state) => state.organizationId === organizationId)
      .map(({ scopeType, scopeId, changedAt, appliedAt, raisedAt, shortenedAt }) => ({
        scopeType,
        scopeId,
        changedAt,
        appliedAt,
        raisedAt,
        shortenedAt,
      }));
  }
}
