import type { SuiteService as SuiteServiceContract } from "@langwatch/suite-contract";
import { PrismaSuiteRepository, type SuiteDatabase } from "../repositories/prisma/prisma.suite.repository";
import { SuiteService, type SuiteServiceOptions } from "../services/suite.service";

export type PostgresSuiteAdapterOptions = Omit<SuiteServiceOptions, "repository"> & {
  database: SuiteDatabase;
};

export class PostgresSuiteAdapter {
  static create(options: PostgresSuiteAdapterOptions): SuiteServiceContract {
    return SuiteService.create({
      repository: PrismaSuiteRepository.create(options.database),
      scenarios: options.scenarios,
      agents: options.agents,
      prompts: options.prompts,
      execution: options.execution,
      generateId: options.generateId,
      now: options.now,
    });
  }
}
