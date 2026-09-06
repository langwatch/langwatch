import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ScenarioService } from "@langwatch/scenario-contract";
import type { SuiteService as SuiteServiceContract } from "@langwatch/suite-contract";
import {
  PrismaSuiteRepository,
  type SuiteDatabase,
} from "../repositories/prisma/prisma.suite.repository.ts";
import { ClickHouseSuiteRunRepository } from "../repositories/clickhouse/clickhouse.suite-run.repository.ts";
import type { SuiteExecutionPort } from "../ports/suite-execution.port.ts";
import type { SuiteClickHouseClient } from "../ports/suite-clickhouse.port.ts";
import type { SuiteRunReadRepository } from "../repositories/suite-run.repository.ts";
import { MemorySuiteRunRepository } from "../repositories/memory/memory.suite-run.repository.ts";
import type { ConnectedPresenceReader } from "../services/connected-target.service.ts";
import { SuiteService } from "../services/suite.service.ts";
import type { SuiteEventingCapabilities, SuiteRuntimePort } from "../ports/suite-runtime.port.ts";

export type PostgresSuiteAdapterOptions = {
  database: SuiteDatabase;
  scenarios: ScenarioService;
  agents: AgentService;
  prompts: PromptService;
  execution: SuiteExecutionPort;
  /** Which connected agents have a process attached; absent when none is composed. */
  connectedPresence?: ConnectedPresenceReader;
  resolveClickHouseClient: ((projectId: string) => Promise<SuiteClickHouseClient>) | null;
  defaultRetentionDays: number;
  generateId?: () => string;
  now?: () => Date;
};

export class PostgresSuiteAdapter implements SuiteRuntimePort {
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
      ...(options.connectedPresence ? { connectedPresence: options.connectedPresence } : {}),
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
