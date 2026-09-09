import type { ScenarioService as ScenarioServiceContract } from "@langwatch/scenario-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { ScenarioClockPort } from "../ports/scenario-clock.port.ts";
import type { ScenarioTestSuiteIdPort, ScenarioIdPort } from "../ports/scenario-id.port.ts";
import type { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port.ts";
import { ScenarioService } from "../services/scenario.service.ts";
import { PrismaScenarioRepository } from "../repositories/prisma/scenario.repository.ts";

/** Process-composition adapter for the Scenario service's private Prisma port. */
export class PrismaScenarioAdapter {
  static create(options: {
    prisma: Parameters<typeof PrismaScenarioRepository.create>[0];
    simulations: SimulationService;
    ids: ScenarioIdPort;
    testSuiteIds: ScenarioTestSuiteIdPort;
    clock: ScenarioClockPort;
    secretCipher: ScenarioSecretCipherPort;
  }): ScenarioServiceContract {
    return ScenarioService.create({
      repository: PrismaScenarioRepository.create(options.prisma),
      simulations: options.simulations,
      ids: options.ids,
      testSuiteIds: options.testSuiteIds,
      clock: options.clock,
      secretCipher: options.secretCipher,
    });
  }
}
