export type ExperimentSubjectType = "USER" | "ORGANIZATION" | "PROJECT";

export interface ExperimentSubject {
  subjectType: ExperimentSubjectType;
  subjectId: string;
}

export interface ExperimentSetting extends ExperimentSubject {
  flagKey: string;
  enabled: boolean;
}

/**
 * Durable experiment settings: a person's enrolment and an owner's policy
 * for a tenant scope, keyed by subject. Read per request, not through the
 * flag row cache — that would be the per-context fan-out it exists to avoid.
 */
export interface FeatureFlagExperimentRepository {
  /** Every setting among `flagKeys` for any of `subjects`. */
  findForSubjects(input: {
    flagKeys: readonly string[];
    subjects: readonly ExperimentSubject[];
  }): Promise<ExperimentSetting[]>;

  upsert(input: ExperimentSetting & { changedByUserId: string | null }): Promise<void>;

  /** Removing the row is how a tenant scope returns to `inherit`. */
  remove(input: { flagKey: string } & ExperimentSubject): Promise<void>;
}
