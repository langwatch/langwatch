/**
 * Process capabilities a scenario write reaches: product analytics and lifecycle nurturing.
 * Fire-and-forget; failures go to captureException, not the caller.
 */
export abstract class ScenarioActivity {
  /** Records the product-analytics event for a newly created scenario. */
  abstract trackScenarioCreated(input: Readonly<{ userId: string; projectId: string }>): void;

  /** Drives the "you have written N test cases" nurturing sequence. */
  abstract fireScenarioCreatedNurturing(
    input: Readonly<{
      userId: string;
      scenarioCount: number;
      scenarioId: string;
      projectId: string;
    }>,
  ): void;

  /** Where a failure in either of the above goes instead of the caller. */
  abstract captureException(error: Error | string): void;
}

/** A process that reports none of it: every call is dropped on the floor. */
export class SilentScenarioActivity extends ScenarioActivity {
  trackScenarioCreated(): void {
    // Nothing is recorded on a process that composed no analytics.
  }

  fireScenarioCreatedNurturing(): void {
    // Nothing is nurtured on a process that composed no lifecycle sender.
  }

  captureException(): void {
    // The failure it would report cannot happen: nothing above can fail.
  }
}
