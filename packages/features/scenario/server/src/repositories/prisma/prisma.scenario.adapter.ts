import type { ScenarioService as ScenarioServiceContract } from "@langwatch/scenario-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { ScenarioClockPort } from "../../ports/scenario-clock.port";
import type { ScenarioFolderIdPort, ScenarioIdPort } from "../../ports/scenario-id.port";
import type { ScenarioSecretCipherPort } from "../../ports/scenario-secret-cipher.port";
import { ScenarioService } from "../../services/scenario.service";
import { PrismaScenarioRepository } from "./scenario.repository";

/** Process-composition adapter for the Scenario service's private Prisma port. */
export class PrismaScenarioAdapter {
  static create(options: {
    prisma: PrismaClient;
    simulations: SimulationService;
    ids: ScenarioIdPort;
    folderIds: ScenarioFolderIdPort;
    clock: ScenarioClockPort;
    secretCipher: ScenarioSecretCipherPort;
  }): ScenarioServiceContract {
    return ScenarioService.create({
      repository: PrismaScenarioRepository.create(options.prisma),
      simulations: options.simulations,
      ids: options.ids,
      folderIds: options.folderIds,
      clock: options.clock,
      secretCipher: options.secretCipher,
    });
  }
}
