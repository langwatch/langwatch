import type { AgentService } from "@langwatch/agent-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ScenarioService } from "@langwatch/scenario-contract";
import type { SuiteService as SuiteServiceContract } from "@langwatch/suite-contract";
import { PrismaSuiteRepository } from "../repositories/prisma/prisma.suite.repository";
import { ClickHouseSuiteRunRepository } from "../repositories/clickhouse/clickhouse.suite-run.repository";
import type { SuiteExecutionPort } from "../ports/suite-execution.port";
import type { SuiteClickHouseClient } from "../ports/suite-clickhouse.port";
import type { SuiteRunReadRepository } from "../repositories/suite-run.repository";
import { MemorySuiteRunRepository } from "../repositories/memory/memory.suite-run.repository";
import { SuiteService } from "../services/suite.service";
import type { SuiteEventingCapabilities, SuiteRuntimeAdapter } from "./suite-runtime.adapter";

export type PostgresSuiteAdapterOptions = {
  database: PrismaClient;
  scenarios: ScenarioService;
  agents: AgentService;
  prompts: PromptService;
  execution: SuiteExecutionPort;
  resolveClickHouseClient: ((projectId: string) => Promise<SuiteClickHouseClient>) | null;
  defaultRetentionDays: number;
  generateId?: () => string;
  now?: () => Date;
};

export class PostgresSuiteAdapter implements SuiteRuntimeAdapter {
  static create(options: PostgresSuiteAdapterOptions): PostgresSuiteAdapter {
    return new PostgresSuiteAdapter(options);
  }

  private readonly runState: SuiteEventingCapabilities["suiteRunState"] & SuiteRunReadRepository;
  private readonly service: SuiteServiceContract;

  private constructor(options: PostgresSuiteAdapterOptions) {
    this.runState = options.resolveClickHouseClient
      ? ClickHouseSuiteRunRepository.create({
          resolveClient: options.resolveClickHouseClient,
          defaultRetentionDays: options.defaultRetentionDays,
        })
      : MemorySuiteRunRepository.create();
    this.service = SuiteService.create({
      repository: PrismaSuiteRepository.create(options.database),
      runRepository: this.runState,
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
    return { suiteRunState: this.runState };
  }
}
