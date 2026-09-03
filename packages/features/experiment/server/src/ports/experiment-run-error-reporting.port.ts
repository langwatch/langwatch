/**
 * Where a run's unexpected failure is reported, beyond the log line.
 *
 * The retired application sent these to its product-analytics capture. Nothing
 * downstream of the run reads the report, and a deployment that composes none
 * loses no behaviour the customer can see — so the collaborator is optional and
 * says so, rather than a null object that reads as wired.
 */
export abstract class ExperimentRunErrorReportingPort {
  abstract captureException(error: unknown, context: { extra: Record<string, unknown> }): void;
}
