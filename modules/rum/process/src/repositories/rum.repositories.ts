import type { RumRateLimitRepository } from "./rum-rate-limit.repository.ts";

export interface RumRepositories {
  readonly rateLimits: RumRateLimitRepository;
}
