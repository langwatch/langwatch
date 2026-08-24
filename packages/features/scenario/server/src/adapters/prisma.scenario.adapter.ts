import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ScenarioService as ScenarioServiceContract } from "@langwatch/scenario-contract";
import { PrismaScenarioRepository } from "../repositories/prisma/prisma.scenario.repository";
import { ScenarioService } from "../services/scenario.service";

/** Process-composition adapter for the Scenario service's private Prisma port. */
export class PrismaScenarioAdapter {
  static create(options: {
    prisma: PrismaClient;
    generateId: () => string;
    now?: () => Date;
  }): ScenarioServiceContract {
    return ScenarioService.create({
      repository: PrismaScenarioRepository.create({ prisma: options.prisma }),
      generateId: options.generateId,
      now: options.now,
    });
  }
}
