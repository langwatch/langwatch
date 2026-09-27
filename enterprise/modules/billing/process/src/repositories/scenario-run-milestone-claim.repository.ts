/**
 * Owns the one claim per delivered event a scenario-run milestone is tracked
 * against, so a redelivered event does not track its milestone twice.
 */
export abstract class ScenarioRunMilestoneClaimRepository {
  /** `true` only for the first claim of this event id; every redelivery reads `false`. */
  abstract claim(input: { eventId: string }): Promise<boolean>;
}
