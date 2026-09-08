import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaBatchEvaluationRepository } from "./prisma.batch-evaluation.repository.ts";
import { PrismaDatasetContentRepository } from "./prisma.dataset-content.repository.ts";
import { PrismaDatasetRecordContentRepository } from "./prisma.dataset-record-content.repository.ts";
import { PrismaDatasetRecordRepository } from "./prisma.dataset-record.repository.ts";
import { PrismaDatasetRepository } from "./prisma.dataset.repository.ts";

export const PostgresDatasetRepositories = prismaRepositories({
  datasets: PrismaDatasetRepository,
  records: PrismaDatasetRecordRepository,
  content: PrismaDatasetContentRepository,
  recordContent: PrismaDatasetRecordContentRepository,
  batchEvaluations: PrismaBatchEvaluationRepository,
});
