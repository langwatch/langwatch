import type { SuiteService as SuiteServiceContract } from "@langwatch/suite-contract";
import { PrismaSuiteRepository, type SuiteDatabase } from "../repositories/prisma/prisma.suite.repository";
import { SuiteService } from "../services/suite.service";

export type PostgresSuiteAdapterOptions = {
  database: SuiteDatabase;
  generateId?: () => string;
  now?: () => Date;
};

export class PostgresSuiteAdapter {
  static create(options: PostgresSuiteAdapterOptions): SuiteServiceContract {
    return SuiteService.create({
      repository: PrismaSuiteRepository.create(options.database),
      generateId: options.generateId,
      now: options.now,
    });
  }
}
