import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ScenarioSecretCipher } from "../../app/scenario.app.ts";
import type { ScenarioRepositories } from "../scenario.repositories.ts";
import { PrismaScenarioRepository } from "./scenario.repository.ts";

/**
 * The Scenario aggregate over Postgres. Table-ownership declaration
 * (ADR-134's `prismaTables`) is not yet added to {@link PrismaScenarioRepository};
 * this bundle only selects the backend.
 */
export class PostgresScenarioRepositories {
  static readonly requires = ["prisma", "encryption"] as const;

  /** The live repository seals and opens a run's secret parameters with the deployment's cipher. */
  static create({
    prisma,
    encryption,
  }: {
    prisma: PrismaClient;
    encryption: ScenarioSecretCipher;
  }): Pick<ScenarioRepositories, "scenarios"> {
    return { scenarios: PrismaScenarioRepository.create(prisma, encryption) };
  }
}
