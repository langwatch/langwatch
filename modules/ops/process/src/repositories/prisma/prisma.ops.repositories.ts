import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaBugReportRepository } from "./prisma.bug-report.repository.ts";

export const PostgresOpsRepositories = prismaRepositories({
  bugReports: PrismaBugReportRepository,
});
