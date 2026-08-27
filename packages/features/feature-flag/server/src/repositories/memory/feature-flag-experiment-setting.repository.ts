import {
  FeatureFlagExperimentRepository,
  type ExperimentSetting,
  type ExperimentSubject,
} from "../feature-flag-experiment-setting.repository";

function keyOf({
  flagKey,
  subjectType,
  subjectId,
}: { flagKey: string } & ExperimentSubject): string {
  return `${flagKey} ${subjectType} ${subjectId}`;
}

/** Experiment settings held in process, for tests. */
export class MemoryFeatureFlagExperimentRepository extends FeatureFlagExperimentRepository {
  private readonly settings = new Map<string, ExperimentSetting>();

  static create(): MemoryFeatureFlagExperimentRepository {
    return new MemoryFeatureFlagExperimentRepository();
  }

  async findForSubjects({
    flagKeys,
    subjects,
  }: {
    flagKeys: readonly string[];
    subjects: readonly ExperimentSubject[];
  }): Promise<ExperimentSetting[]> {
    return [...this.settings.values()].filter(
      (setting) =>
        flagKeys.includes(setting.flagKey) &&
        subjects.some(
          (subject) =>
            subject.subjectType === setting.subjectType && subject.subjectId === setting.subjectId,
        ),
    );
  }

  async upsert(input: ExperimentSetting & { changedByUserId: string | null }): Promise<void> {
    const { changedByUserId: _changedByUserId, ...setting } = input;
    this.settings.set(keyOf(setting), setting);
  }

  async remove(input: { flagKey: string } & ExperimentSubject): Promise<void> {
    this.settings.delete(keyOf(input));
  }
}
