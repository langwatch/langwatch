/**
 * The per-user daily count of pull requests Langy opened, one counter per day bucket, expiring
 * two days after it was first written. Spec: specs/langy/langy-github-prs.feature.
 */
export abstract class LangyGithubPrCountRepository {
  /** The bucket's count, zero when nothing was counted yet. */
  abstract count(key: string): Promise<number>;

  /** Adds to the bucket and answers the new count; a new bucket gets its lifetime. */
  abstract add(input: { key: string; amount: number }): Promise<number>;

  /** Takes back the one increment that took the count past the cap. */
  abstract takeBack(key: string): Promise<void>;

  /** Gives back a reserved permit, never below zero (a double release must not grant more). */
  abstract release(key: string): Promise<void>;
}

/** Two days: a margin around clock skew, while the bucket key itself rotates daily. */
export const LANGY_GITHUB_PR_BUCKET_TTL_SECONDS = 60 * 60 * 24 * 2;
