import type { ExperimentService as ExperimentServiceContract } from "@langwatch/experiment-contract";
import {
  PrismaExperimentRepository,
  type ExperimentDatabase,
} from "../repositories/prisma/prisma.experiment.repository";
import { ExperimentService } from "../services/experiment.service";

export type PostgresExperimentAdapterOptions = {
  database: ExperimentDatabase;
  slugify: (value: string) => string;
  newId: () => string;
  now?: () => Date;
};

export class PostgresExperimentAdapter {
  static create(
    options: PostgresExperimentAdapterOptions,
  ): ExperimentServiceContract {
    return ExperimentService.create({
      ...options,
      repository: PrismaExperimentRepository.create(options.database),
    });
  }
}
