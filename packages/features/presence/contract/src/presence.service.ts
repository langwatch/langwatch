import type {
  PresenceCursorInput,
  PresenceLeaveInput,
  PresenceProjectInput,
  PresenceSession,
  PresenceUpdateInput,
} from "./presence";

export abstract class PresenceService {
  abstract isEnabledForProject(
    input: PresenceProjectInput,
  ): Promise<boolean>;
  abstract update(input: PresenceUpdateInput): Promise<PresenceSession>;
  abstract leave(input: PresenceLeaveInput): Promise<void>;
  abstract list(input: PresenceProjectInput): Promise<PresenceSession[]>;
  abstract broadcastCursor(input: PresenceCursorInput): Promise<void>;
}
