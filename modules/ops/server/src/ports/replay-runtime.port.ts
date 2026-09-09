import type {
  RegisteredFoldProjection,
  RegisteredMapProjection,
  RegisteredStateProjection,
  ReplayService as EventingReplayService,
} from "@langwatch/eventing";

/**
 * One replay run's engine, built fresh per run: its own Redis connection, its
 * own ClickHouse readers and the projections it can rebuild.
 */
export interface OpsReplayRuntime {
  service: EventingReplayService;
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  /**
   * Discovered Postgres operational state projections, carrying their
   * definition and store for a paused, from-init canonical rebuild.
   */
  stateProjections: RegisteredStateProjection[];
  close: () => Promise<void>;
}

/**
 * Builds the runtime a replay run drives. The engine reaches the deployment's
 * ClickHouse resolver, its Redis and every feature's projection stores, so the
 * composition owns it; ops owns when a replay starts, what it covers and how it
 * is reported.
 *
 * `create` THROWS when the deployment cannot serve a replay (no Redis, no
 * ClickHouse route). `ReplayService` finalises the run with that message rather
 * than leaving a lock held on a run that never began.
 */
export abstract class OpsReplayRuntimePort {
  abstract create(): OpsReplayRuntime;
}
