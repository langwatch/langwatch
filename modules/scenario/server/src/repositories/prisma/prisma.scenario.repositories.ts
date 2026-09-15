import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ScenarioRepositories } from "../scenario.repositories.ts";
import { PrismaScenarioRepository } from "./scenario.repository.ts";

/**
 * The Scenario aggregate over Postgres. Table-ownership declaration
 * (ADR-134's `prismaTables`) is not yet added to {@link PrismaScenarioRepository};
 * this bundle only selects the backend.
 */
export class PostgresScenarioRepositories {
  static readonly requires = ["prisma"] as const;

  static create({ prisma }: { prisma: PrismaClient }): ScenarioRepositories {
    return { scenarios: PrismaScenarioRepository.create(prisma) };
  }
}
