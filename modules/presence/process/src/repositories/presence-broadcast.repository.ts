import type { PresenceBroadcast, PresenceEmitter } from "../app/presence.app.ts";

/** The tenant broadcast fabric: what the module publishes, relays and lends its peers. */
export interface PresenceBroadcastRepository extends PresenceBroadcast, PresenceEmitter {
  start(): Promise<void>;
  close(): Promise<void>;
}
