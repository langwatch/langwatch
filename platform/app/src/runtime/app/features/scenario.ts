import type { ScenarioService } from "@langwatch/scenario-contract";
import { PrismaScenarioAdapter } from "@langwatch/scenario-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

export class AppScenarioRuntime {
  static create(options: {
    database: PrismaClient;
    generateId: () => string;
    now?: () => Date;
  }): AppScenarioRuntime {
    return new AppScenarioRuntime(options);
  }

  private constructor(
    private readonly options: {
      database: PrismaClient;
      generateId: () => string;
      now?: () => Date;
    },
  ) {}

  build(): ScenarioService {
    return PrismaScenarioAdapter.create({
      prisma: this.options.database,
      generateId: this.options.generateId,
      now: this.options.now,
    });
  }
}
