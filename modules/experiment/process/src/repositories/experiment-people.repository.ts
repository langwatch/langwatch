/** The display names behind the author ids a version history stores. */
export abstract class ExperimentPeopleRepository {
  abstract namesOf(
    ids: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]>;
}
