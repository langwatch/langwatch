import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { ScimSyncNotFoundError, type ScimSyncState } from "@langwatch/identity-contract";

import type { ScimSyncFoldState } from "../../eventing/scim-sync-state.projection.ts";
import { ScimSyncReadRepository } from "../scim-sync.repository.ts";

/** The directory-sync heads in memory: the fold's store and the reads over it. */
export class MemoryScimSyncProjectionRepository
  extends ScimSyncReadRepository
  implements StateProjectionStore<ScimSyncFoldState>
{
  static create(): MemoryScimSyncProjectionRepository {
    return new MemoryScimSyncProjectionRepository();
  }

  private readonly heads = new Map<string, StoredProjection<ScimSyncFoldState>>();

  private constructor() {
    super();
  }

  async get(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<ScimSyncFoldState>> {
    const projection = this.heads.get(key);
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<ScimSyncFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.heads.set(context.aggregateId, projection);
  }

  async getSync(args: { scimSyncId: string; organizationId: string }): Promise<ScimSyncState> {
    const state = this.heads.get(args.scimSyncId)?.state;
    if (!state || state.organizationId !== args.organizationId) {
      throw new ScimSyncNotFoundError(args.scimSyncId);
    }
    return state;
  }

  async findForOrganization(args: { organizationId: string }): Promise<ScimSyncState[]> {
    return this.newestFirst().filter((state) => state.organizationId === args.organizationId);
  }

  async listPageForOperator(args: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<{ syncs: ScimSyncState[]; total: number }> {
    const term = args.search?.trim().toLowerCase();
    const matching = this.newestFirst().filter(
      (state) =>
        !term ||
        [state.scimSyncId, state.connectionId, state.organizationId].some((value) =>
          value.toLowerCase().includes(term),
        ),
    );
    const start = (args.page - 1) * args.pageSize;
    return { syncs: matching.slice(start, start + args.pageSize), total: matching.length };
  }

  async findByConnectionForOperator(args: { connectionId: string }): Promise<ScimSyncState[]> {
    return this.newestFirst().filter((state) => state.connectionId === args.connectionId);
  }

  private newestFirst(): ScimSyncFoldState[] {
    return [...this.heads.values()]
      .map((projection) => projection.state)
      .toSorted((a, b) => b.UpdatedAt - a.UpdatedAt);
  }
}
