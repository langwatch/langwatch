import { PrismaRepository } from "@langwatch/prisma-client";
import type {
  ExperimentSetting,
  ExperimentSubject,
  FeatureFlagExperimentRepository,
} from "../feature-flag-experiment-setting.repository.ts";

const experimentSettingSelect = {
  flagKey: true,
  subjectType: true,
  subjectId: true,
  enabled: true,
} as const;

/**
 * One row per (flag, subject): a person's own enrolment, or an owner's policy
 * for one exact tenant scope. Subject ids are project, organization and user
 * ids, so the table carries no project column of its own.
 */
export class PrismaFeatureFlagExperimentSettingRepository
  extends PrismaRepository.for("FeatureFlagExperimentSetting")
  implements FeatureFlagExperimentRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaFeatureFlagExperimentSettingRepository(prisma),
  );

  async findForSubjects({
    flagKeys,
    subjects,
  }: {
    flagKeys: readonly string[];
    subjects: readonly ExperimentSubject[];
  }): Promise<ExperimentSetting[]> {
    if (flagKeys.length === 0 || subjects.length === 0) return [];

    return this.prisma.featureFlagExperimentSetting.findMany({
      where: {
        flagKey: { in: [...flagKeys] },
        OR: subjects.map((subject) => ({
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
        })),
      },
      select: experimentSettingSelect,
    });
  }

  async upsert({
    flagKey,
    subjectType,
    subjectId,
    enabled,
    changedByUserId,
  }: ExperimentSetting & { changedByUserId: string | null }): Promise<void> {
    await this.prisma.featureFlagExperimentSetting.upsert({
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
    await this.prisma.featureFlagExperimentSetting.deleteMany({
      where: { flagKey, subjectType, subjectId },
    });
  }
}
