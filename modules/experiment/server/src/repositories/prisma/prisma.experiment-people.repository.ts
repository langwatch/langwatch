import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ExperimentPeople } from "../../app/experiment.app.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type ExperimentPeopleDatabase = Pick<PrismaClient, "user">;

/** The display names behind the author ids a version history stores. */
export class PrismaExperimentPeopleRepository implements ExperimentPeople {
  static create(database: ExperimentPeopleDatabase): PrismaExperimentPeopleRepository {
    return new PrismaExperimentPeopleRepository(database);
  }

  private constructor(private readonly database: ExperimentPeopleDatabase) {}

  async namesOf(
    ids: readonly string[],
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>> {
    if (ids.length === 0) return [];
    return this.database.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }
}
