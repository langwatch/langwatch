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
 * Durable experiment settings: a person's own enrolment and an owner's
 * policy for a tenant scope, in one table keyed by subject.
 *
 * These are read per request rather than through the flag row cache: they
 * differ per person, so caching them behind one key per flag is exactly the
 * per-context fan-out the flag cache exists to avoid.
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
