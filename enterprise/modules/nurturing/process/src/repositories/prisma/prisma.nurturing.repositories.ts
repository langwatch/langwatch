// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaNurturingMilestonesRepository } from "./prisma.nurturing-milestones.repository.ts";

export const PostgresNurturingRepositories = prismaRepositories({
  milestones: PrismaNurturingMilestonesRepository,
});
