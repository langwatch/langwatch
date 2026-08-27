import {
  FeatureFlagExperimentRepository,
  type ExperimentSetting,
  type ExperimentSubject,
} from "./feature-flag-experiment-setting.repository";

type DelegateCall<TResult> = {
  bivariant(input: object): Promise<TResult>;
}["bivariant"];

type ExperimentSettingDelegate = {
  findMany: DelegateCall<ExperimentSetting[]>;
  upsert: DelegateCall<unknown>;
  deleteMany: DelegateCall<unknown>;
};

export type FeatureFlagExperimentDatabase = {
  featureFlagExperimentSetting: ExperimentSettingDelegate;
};

export class PrismaFeatureFlagExperimentRepository extends FeatureFlagExperimentRepository {
  private constructor(private readonly database: FeatureFlagExperimentDatabase) {
    super();
  }

  static create(database: FeatureFlagExperimentDatabase): PrismaFeatureFlagExperimentRepository {
    return new PrismaFeatureFlagExperimentRepository(database);
  }

  async findForSubjects({
    flagKeys,
    subjects,
  }: {
    flagKeys: readonly string[];
    subjects: readonly ExperimentSubject[];
  }): Promise<ExperimentSetting[]> {
    if (flagKeys.length === 0 || subjects.length === 0) return [];

    return await this.database.featureFlagExperimentSetting.findMany({
      where: {
        flagKey: { in: [...flagKeys] },
        OR: subjects.map((subject) => ({
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
        })),
      },
      select: {
        flagKey: true,
        subjectType: true,
        subjectId: true,
        enabled: true,
      },
    });
  }

  async upsert({
    flagKey,
    subjectType,
    subjectId,
    enabled,
    changedByUserId,
  }: ExperimentSetting & { changedByUserId: string | null }): Promise<void> {
    await this.database.featureFlagExperimentSetting.upsert({
      where: {
        flagKey_subjectType_subjectId: { flagKey, subjectType, subjectId },
      },
      create: { flagKey, subjectType, subjectId, enabled, changedByUserId },
      update: { enabled, changedByUserId },
    });
  }

  async remove({
    flagKey,
    subjectType,
    subjectId,
  }: { flagKey: string } & ExperimentSubject): Promise<void> {
    await this.database.featureFlagExperimentSetting.deleteMany({
      where: { flagKey, subjectType, subjectId },
    });
  }
}
