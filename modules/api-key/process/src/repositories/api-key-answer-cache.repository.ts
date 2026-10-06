/**
 * How long Redis holds a key's answer: the bound on an answer nobody deleted (Alex, 2026-10-01).
 */
export const API_KEY_ANSWER_TTL_MS = 5_000;
/** How long "no such key" is held, so a flood of unknown tokens meets one read a moment. */
export const API_KEY_UNKNOWN_TTL_MS = 2_000;

/**
 * The token answers every pod shares. Postgres stays the truth: a lost entry costs one read,
 * and a revoke overwrites the entry with a refusal that no late fill can replace.
 */
export abstract class ApiKeyAnswerCacheRepository {
  abstract findValues(input: { key: string }): Promise<string[]>;
  /**
   * Holds a value for `ttlMs`, never longer than {@link API_KEY_ANSWER_TTL_MS}. With
   * `onlyIfAbsent`, an entry already there wins, so a late fill never overwrites a revoke.
   */
  abstract set(input: {
    key: string;
    value: string;
    ttlMs: number;
    onlyIfAbsent?: boolean;
  }): Promise<void>;
  abstract delete(input: { key: string }): Promise<void>;
}
