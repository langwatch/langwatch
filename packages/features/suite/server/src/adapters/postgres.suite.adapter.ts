import type { Projection, ProjectionStore } from "@langwatch/eventing";
import type { SuiteService as SuiteServiceContract } from "@langwatch/suite-contract";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import {
  PrismaSuiteRepository,
  type SuiteDatabase,
} from "../repositories/prisma/prisma.suite.repository";
import { ClickHouseSuiteRunRepository } from "../repositories/clickhouse/clickhouse.suite-run.repository";
import type { SuiteClickHouseClient } from "../ports/suite-clickhouse.port";
import type { SuiteRunRepository } from "../repositories/suite-run.repository";
import { MemorySuiteRunRepository } from "../repositories/memory/memory.suite-run.repository";
import { SuiteService, type SuiteServiceOptions } from "../services/suite.service";

export type PostgresSuiteAdapterOptions = Omit<
  SuiteServiceOptions,
  "repository" | "runRepository"
> & {
  database: SuiteDatabase;
  resolveClickHouseClient: ((projectId: string) => Promise<SuiteClickHouseClient>) | null;
  defaultRetentionDays: number;
};

/** Application-facing Eventing capability; the repository itself stays private. */
export type SuiteEventingCapabilities = {
  suiteRunState: ProjectionStore<Projection<SuiteRunStateData>>;
};

export class PostgresSuiteAdapter {
  static create(options: PostgresSuiteAdapterOptions): PostgresSuiteAdapter {
    return new PostgresSuiteAdapter(options);
  }

  private readonly runRepository: SuiteRunRepository;
  private readonly service: SuiteServiceContract;

  private constructor(options: PostgresSuiteAdapterOptions) {
    this.runRepository = options.resolveClickHouseClient
      ? ClickHouseSuiteRunRepository.create({
          resolveClient: options.resolveClickHouseClient,
          defaultRetentionDays: options.defaultRetentionDays,
        })
      : MemorySuiteRunRepository.create();
    this.service = SuiteService.create({
      repository: PrismaSuiteRepository.create(options.database),
      runRepository: this.runRepository,
      scenarios: options.scenarios,
      agents: options.agents,
      prompts: options.prompts,
      execution: options.execution,
      generateId: options.generateId,
      now: options.now,
    });
  }

  build(): SuiteServiceContract {
    return this.service;
  }

  eventing(): SuiteEventingCapabilities {
    return { suiteRunState: this.runRepository };
  }
}
