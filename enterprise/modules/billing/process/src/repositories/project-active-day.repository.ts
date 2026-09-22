/**
 * Owns the one claim-per-project-per-UTC-day billing tracks a milestone
 * against: the first application trace of the day, or the first successful
 * scenario run, whichever lands first.
 */
export abstract class ProjectActiveDayRepository {
  /**
   * Claims the day for a project. Returns `true` only for the call that
   * wins the race — every later caller the same day reads `false` and skips
   * the milestone, so a day is tracked exactly once.
   */
  abstract claimDay(input: { projectId: string; day: string }): Promise<boolean>;
}
