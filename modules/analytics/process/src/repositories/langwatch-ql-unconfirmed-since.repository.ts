/**
 * When the fleet first saw ClickHouse not holding the app's collection values (#8858), shared by
 * every worker so the alert waits on time, not on one worker's run of checks.
 * @see specs/lwql/api.feature
 */
export abstract class LwqlUnconfirmedSinceRepository {
  /** Records `at` unless a run is open; answers the open run's first failure. */
  abstract mark(at: number): Promise<number>;
  /** Ends the run: the next failure starts a new one. */
  abstract clear(): Promise<void>;
}
