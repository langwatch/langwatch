import type { SsoConnectionState } from "@langwatch/identity-contract";

import type { SsoEngineProviderRow } from "../rules/sso-engine-provider.rules.ts";

/**
 * Where the engine's provider row is kept (D09). The writes never ask what
 * the row said - every fold derives it from the connection head - and the
 * read asks only whether one is there, which is half of being dialable.
 */
export abstract class SsoEngineProviderRepository {
  /** Keep this connection's row, replacing whatever stood for it. */
  abstract put(row: SsoEngineProviderRow): Promise<void>;
  /**
   * Whether the engine holds a provider registered for this connection: the
   * organization's own side of being dialable, which the method this
   * deployment mounts cannot answer for.
   */
  abstract findRegisteredProvider(args: { connectionId: string }): Promise<boolean>;
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
