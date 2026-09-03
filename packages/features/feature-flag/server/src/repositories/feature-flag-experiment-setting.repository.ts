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
export abstract class FeatureFlagExperimentRepository {
  /** Every setting among `flagKeys` for any of `subjects`. */
  abstract findForSubjects(input: {
    flagKeys: readonly string[];
    subjects: readonly ExperimentSubject[];
  }): Promise<ExperimentSetting[]>;

  abstract upsert(input: ExperimentSetting & { changedByUserId: string | null }): Promise<void>;

  /** Removing the row is how a tenant scope returns to `inherit`. */
  abstract remove(input: { flagKey: string } & ExperimentSubject): Promise<void>;
}
