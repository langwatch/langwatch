import { PrismaProcessStore } from "@langwatch/eventing/server";
import { prismaRepositories } from "@langwatch/prisma-client";

import type { OpsRepositories } from "../ops.repositories.ts";
import { PrismaBugReportRepository } from "./prisma.bug-report.repository.ts";

const claimedOpsRepositories = prismaRepositories({
  bugReports: PrismaBugReportRepository,
});

/** The claimed rows, plus eventing's own process store over the same client. */
export const PostgresOpsRepositories = {
  ...claimedOpsRepositories,
  create: (members: Parameters<typeof claimedOpsRepositories.create>[0]): OpsRepositories => ({
    ...claimedOpsRepositories.create(members),
    processStore: PrismaProcessStore.create({ database: members.prisma }),
  }),
};
