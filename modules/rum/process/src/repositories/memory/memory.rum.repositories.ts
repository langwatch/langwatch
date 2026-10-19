import type { RumRepositories } from "../rum.repositories.ts";
import { MemoryRumRateLimitRepository } from "./memory.rum-rate-limit.repository.ts";

export class MemoryRumRepositories {
  static readonly requires = [] as const;

  static create(): RumRepositories {
    return { rateLimits: MemoryRumRateLimitRepository.create() };
  }
}
