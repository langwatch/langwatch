import type { PresenceSettingsRepository } from "./presence-settings.repository.ts";
import type { PresenceRepository } from "./presence.repository.ts";

export interface PresenceRepositories {
  readonly sessions: PresenceRepository;
  readonly settings: PresenceSettingsRepository;
}
