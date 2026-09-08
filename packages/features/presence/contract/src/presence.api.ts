import { featureApi } from "@langwatch/runtime-composition";
import type {
  PresenceCursorEvent,
  PresenceCursorSubscription,
  PresenceCursorTickInput,
  PresenceEvent,
  PresenceHeartbeatInput,
  PresenceLeaveInput,
  PresenceProjectInput,
  PresenceSession,
} from "./presence.ts";

/** Portable cancellation shape; browser and Node AbortSignals satisfy it. */
export type PresenceStreamSignal = unknown;

/** Who else is looking at this project, where they are, and where their cursor is. */
export interface PresenceApi {
  isEnabledForProject(input: PresenceProjectInput): Promise<boolean>;
  /** One browser session's heartbeat: its location now, and that it is still here. */
  update(input: PresenceHeartbeatInput): Promise<void>;
  leave(input: PresenceLeaveInput): Promise<void>;
  list(input: PresenceProjectInput): Promise<PresenceSession[]>;
  broadcastCursor(input: PresenceCursorTickInput): Promise<void>;
  events(
    input: PresenceProjectInput & { signal?: PresenceStreamSignal },
  ): AsyncGenerator<PresenceEvent>;
  cursors(
    input: PresenceCursorSubscription & { signal?: PresenceStreamSignal },
  ): AsyncGenerator<PresenceCursorEvent>;
}

export const PresenceApi = featureApi<PresenceApi>("presence");
