import type { AppFunctionStoreProbe } from "../../rules/langwatch-ql-app-function-store.rules.ts";
import type { AnalyticsRepositories } from "../analytics.repositories.ts";
import { LangWatchQLAppFunctionStoreRepository } from "../langwatch-ql-app-function-store.repository.ts";
import {
  MemoryAnalyticsEvaluationRepository,
  type MemoryEvaluationAnalyticsTable,
} from "./memory.analytics-persistence.repository.ts";
import { MemoryAnalyticsRateLimitRepository } from "./memory.analytics-rate-limit.repository.ts";
import { MemoryAnalyticsRecencyRepository } from "./memory.analytics-recency.repository.ts";
import { MemoryAnalyticsSessionsRepository } from "./memory.analytics-sessions.repository.ts";
import { MemoryAnalyticsRepository } from "./memory.analytics.repository.ts";

/** The memory tier has no ClickHouse server to probe: it answers nothing, as a silent one does. */
export class MemoryLangWatchQLAppFunctionStoreRepository extends LangWatchQLAppFunctionStoreRepository {
  static create(): MemoryLangWatchQLAppFunctionStoreRepository {
    return new MemoryLangWatchQLAppFunctionStoreRepository();
  }

  private constructor() {
    super();
  }

  findProbe(): Promise<AppFunctionStoreProbe[]> {
    return Promise.resolve([]);
  }
}

/** The "memory" tier: no ClickHouse or PostgreSQL server, so LangWatchQL is unavailable. */
export class MemoryAnalyticsRepositories {
  static readonly requires = [] as const;

  static create(): AnalyticsRepositories {
    // The evaluation twin writes this table; the recency twin reads it.
    const evaluationRows: MemoryEvaluationAnalyticsTable = new Map();
    const evaluations = MemoryAnalyticsEvaluationRepository.create({ table: evaluationRows });

    return {
      sessions: MemoryAnalyticsSessionsRepository.create(),
      analytics: MemoryAnalyticsRepository.create(),
      evaluations: { open: () => evaluations },
      appFunctionStore: MemoryLangWatchQLAppFunctionStoreRepository.create(),
      recency: MemoryAnalyticsRecencyRepository.create({ evaluations: evaluationRows }),
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
