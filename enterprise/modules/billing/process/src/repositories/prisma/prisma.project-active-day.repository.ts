import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { ProjectActiveDayRepository } from "../project-active-day.repository.ts";

/** Only what this repository touches. */
export type ProjectActiveDayDatabase = Pick<PrismaClient, "projectActiveDay">;

/** Prisma's unique-constraint code, as the claim race arrives. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

export class PrismaProjectActiveDayRepository extends ProjectActiveDayRepository {
  private constructor(private readonly prisma: ProjectActiveDayDatabase) {
    super();
  }

  static create(prisma: ProjectActiveDayDatabase): PrismaProjectActiveDayRepository {
    return new PrismaProjectActiveDayRepository(prisma);
  }

  async claimDay(input: { projectId: string; day: string }): Promise<boolean> {
    return this.prisma.projectActiveDay
      .create({
        data: { projectId: input.projectId, day: input.day },
      })
      .then(() => true)
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return false;
        throw error;
      });
  }
}
