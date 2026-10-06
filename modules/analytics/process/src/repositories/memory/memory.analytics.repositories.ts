import type { AnalyticsRepositories } from "../analytics.repositories.ts";
import { MemoryAnalyticsRateLimitRepository } from "./memory.analytics-rate-limit.repository.ts";
import { MemoryAnalyticsRecencyRepository } from "./memory.analytics-recency.repository.ts";
import { MemoryAnalyticsSessionsRepository } from "./memory.analytics-sessions.repository.ts";
import { MemoryLangWatchQLAppFunctionStoreRepository } from "./memory.langwatch-ql-app-function-store.repository.ts";

/** The "memory" tier: no ClickHouse or PostgreSQL server, so LangWatchQL is unavailable. */
export class MemoryAnalyticsRepositories {
  static readonly requires = [] as const;

  static create(): AnalyticsRepositories {
    return {
      sessions: MemoryAnalyticsSessionsRepository.create(),
      appFunctionStore: MemoryLangWatchQLAppFunctionStoreRepository.create(),
      recency: MemoryAnalyticsRecencyRepository.create(),
      rateLimits: MemoryAnalyticsRateLimitRepository.create(),
      langWatchQl: {
        admin: { configured: false },
        postgres: { configured: false },
        // Read only where both targets are configured, which this tier never is.
        database: () => {
          throw new Error("Memory stores provide no PostgreSQL for LangWatchQL provisioning.");
        },
      },
    };
  }
}
