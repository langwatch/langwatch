/**
 * The pull requests Langy opened for a person in one day, as a set of pull request keys per day
 * bucket: counting the same pull request twice (a redelivered answer) counts it once.
 * Spec: specs/langy/langy-github-prs.feature.
 */
export abstract class LangyGithubPrCountRepository {
  /** How many pull requests the bucket holds, zero when none was counted yet. */
  abstract count(key: string): Promise<number>;

  /** Adds the pull requests to the bucket; a new bucket gets its lifetime. */
  abstract add(input: { key: string; pullRequests: readonly string[] }): Promise<void>;
}

/** Two days: a margin around clock skew, while the bucket key itself rotates daily. */
export const LANGY_GITHUB_PR_BUCKET_TTL_SECONDS = 60 * 60 * 24 * 2;
