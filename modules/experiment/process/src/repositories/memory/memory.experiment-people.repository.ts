import { ExperimentPeopleRepository } from "../experiment-people.repository.ts";

/** People are written by the user module; with no writer here, no author id has a name. */
export class MemoryExperimentPeopleRepository extends ExperimentPeopleRepository {
  static create(): MemoryExperimentPeopleRepository {
    return new MemoryExperimentPeopleRepository();
  }

  private constructor() {
    super();
  }

  namesOf(
    _ids: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]> {
    return Promise.resolve([]);
  }
}
