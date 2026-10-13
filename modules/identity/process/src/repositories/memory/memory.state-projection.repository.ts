import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

/** One fold's heads, per tenant and aggregate: the memory twin of each Prisma projection row. */
export class MemoryStateProjectionRepository<State> implements StateProjectionStore<State> {
  static create<State>(): MemoryStateProjectionRepository<State> {
    return new MemoryStateProjectionRepository<State>();
  }

  private readonly heads = new Map<string, StoredProjection<State>>();

  private constructor() {}

  async get(key: string, context: ProjectionStoreContext): Promise<StoredProjectionRead<State>> {
    const projection = this.heads.get(`${String(context.tenantId)}:${key}`);
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(projection: StoredProjection<State>, context: ProjectionStoreContext): Promise<void> {
    this.heads.set(`${String(context.tenantId)}:${context.aggregateId}`, projection);
  }
}
