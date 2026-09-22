import type { SsoConnectionState } from "@langwatch/identity-contract";

import type { SsoEngineProviderRow } from "../rules/sso-engine-provider.rules.ts";

/**
 * Where the engine's provider row is kept (D09). Two verbs and no read: the
 * row is derived from the connection head on every fold, so nothing here ever
 * needs to ask what it used to say.
 */
export abstract class SsoEngineProviderRepository {
  /** Keep this connection's row, replacing whatever stood for it. */
  abstract put(row: SsoEngineProviderRow): Promise<void>;
  /**
   * Remove it. Removed rather than disabled: a suspended or torn-down
   * connection must stop being dialable, and a row the engine can still find
   * is a row it will still authenticate through.
   */
  abstract remove(args: { connectionId: string }): Promise<void>;
}

/**
 * How the connection head keeps the engine's row in step with itself. Written
 * after the head, not with it: the row is derived from the head, so a crash
 * between the two leaves one the next apply rewrites rather than an orphan.
 */
export interface SsoEngineProviderProjection {
  project(args: { connection: SsoConnectionState }): Promise<void>;
}
