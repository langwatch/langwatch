// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaDigestAudienceRepository } from "./prisma.digest-audience.repository.ts";
import { PrismaDigestSendRepository } from "./prisma.digest-send.repository.ts";
import {
  PrismaDigestProjectWeekRepository,
  PrismaDigestUserWeekRepository,
} from "./prisma.digest-week.repository.ts";

export const PostgresDigestRepositories = prismaRepositories({
  projectWeeks: PrismaDigestProjectWeekRepository,
  userWeeks: PrismaDigestUserWeekRepository,
  sends: PrismaDigestSendRepository,
  audience: PrismaDigestAudienceRepository,
});
