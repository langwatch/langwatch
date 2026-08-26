import type { ScenarioService as ScenarioServiceContract } from "@langwatch/scenario-contract";
import type { SimulationService } from "@langwatch/simulation-contract";
import {
  PrismaScenarioRepository,
  type ScenarioDatabasePort,
} from "../repositories/prisma/scenario.repository";
import { ScenarioService } from "../services/scenario.service";
import type { ScenarioClockPort } from "../ports/scenario-clock.port";
import type { ScenarioIdPort } from "../ports/scenario-id.port";
import type { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port";

/** Process-composition adapter for the Scenario service's private Prisma port. */
export class PrismaScenarioAdapter {
  static create(options: {
    prisma: ScenarioDatabasePort;
    simulations: SimulationService;
    ids: ScenarioIdPort;
    clock: ScenarioClockPort;
    secretCipher: ScenarioSecretCipherPort;
  }): ScenarioServiceContract {
    return ScenarioService.create({
      repository: PrismaScenarioRepository.create({ prisma: options.prisma }),
      simulations: options.simulations,
      ids: options.ids,
      clock: options.clock,
      secretCipher: options.secretCipher,
    });
  }
}
