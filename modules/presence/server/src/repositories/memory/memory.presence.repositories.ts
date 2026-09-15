import type { PresenceRepositories } from "../presence.repositories.ts";
import { MemoryPresenceRepository } from "./memory.presence.repository.ts";

export class MemoryPresenceRepositories {
  static readonly requires = [] as const;

  static create(): PresenceRepositories {
    return { sessions: MemoryPresenceRepository.create() };
  }
}
