import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaInsightDailyScheduleProjectionRepository } from "./prisma.insight-daily-schedule-projection.repository.ts";
import { PrismaInsightDailyScheduleRepository } from "./prisma.insight-daily-schedule.repository.ts";
import { PrismaInsightProjectionRepository } from "./prisma.insight-projection.repository.ts";
import { PrismaInsightReaderProjectionRepository } from "./prisma.insight-reader-projection.repository.ts";
import { PrismaInsightRepository } from "./prisma.insight.repository.ts";

export const PostgresInsightRepositories = prismaRepositories({
  insights: PrismaInsightRepository,
  insightProjection: PrismaInsightProjectionRepository,
  insightReaderProjection: PrismaInsightReaderProjectionRepository,
  dailySchedules: PrismaInsightDailyScheduleRepository,
  dailyScheduleProjection: PrismaInsightDailyScheduleProjectionRepository,
});
