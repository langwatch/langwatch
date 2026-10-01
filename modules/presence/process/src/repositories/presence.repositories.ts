import type { PresenceRepository } from "./presence.repository.ts";

export interface PresenceRepositories {
  readonly sessions: PresenceRepository;
}
