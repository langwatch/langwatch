import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { ExperimentPeopleRepository } from "../experiment-people.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type ExperimentPeopleDatabase = Pick<PrismaClient, "user">;

/** The display names behind the author ids a version history stores. */
export class PrismaExperimentPeopleRepository extends ExperimentPeopleRepository {
  static create(database: ExperimentPeopleDatabase): PrismaExperimentPeopleRepository {
    return new PrismaExperimentPeopleRepository(database);
  }

  private constructor(private readonly database: ExperimentPeopleDatabase) {
    super();
  }

  async namesOf(
    ids: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]> {
    if (ids.length === 0) return [];
    return this.database.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }
}
