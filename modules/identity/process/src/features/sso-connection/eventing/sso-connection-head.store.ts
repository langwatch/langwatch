import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { SsoEngineProviderProjection } from "../repositories/sso-engine-provider.repository.ts";
import type { SsoConnectionFoldState } from "./sso-connection-state.projection.ts";

/** The connection head, then the engine's provider row kept in step with it once it lands (D09). */
export class EngineFollowingSsoConnectionHeadStore implements StateProjectionStore<SsoConnectionFoldState> {
  static create(options: {
    heads: StateProjectionStore<SsoConnectionFoldState>;
    engineProvider: SsoEngineProviderProjection | undefined;
  }): StateProjectionStore<SsoConnectionFoldState> {
    if (!options.engineProvider) return options.heads;
    return new EngineFollowingSsoConnectionHeadStore(options.heads, options.engineProvider);
  }

  private constructor(
    private readonly heads: StateProjectionStore<SsoConnectionFoldState>,
    private readonly engineProvider: SsoEngineProviderProjection,
  ) {}

  get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<SsoConnectionFoldState>> {
    return this.heads.get(key, context);
  }

  async store(
    projection: StoredProjection<SsoConnectionFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.heads.store(projection, context);
    await this.engineProvider.project({
      connection: { ...projection.state, connectionId: context.aggregateId },
    });
  }
}
