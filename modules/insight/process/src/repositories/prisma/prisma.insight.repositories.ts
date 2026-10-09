import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaInsightReaderProjectionStore } from "./prisma.insight-reader.store.ts";
import { PrismaInsightRepository } from "./prisma.insight.repository.ts";
import { PrismaInsightProjectionStore } from "./prisma.insight.store.ts";

export const PostgresInsightRepositories = prismaRepositories({
  insights: PrismaInsightRepository,
  insightProjection: PrismaInsightProjectionStore,
  insightReaderProjection: PrismaInsightReaderProjectionStore,
});
