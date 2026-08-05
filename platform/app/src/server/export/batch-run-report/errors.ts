import { HandledError } from "@langwatch/handled-error";

/**
 * The run report's failures, as codes the caller can act on.
 *
 * Thrown rather than returned as `c.json`: the secured app installs
 * `onError(handleError)`, which serialises a HandledError into a response
 * carrying its code, its meta and the request's trace and span ids. A
 * hand-rolled `c.json({ error }, { status })` drops all of that, so the caller
 * gets an English sentence in the field it branches on and a rejection nothing
 * can correlate to a trace.
 *
 * Every code here has copy in the client presentation registry
 * (`features/errors/logic/presentation.ts`), which is where the words a person
 * actually reads live. The messages below are the server's own and are never
 * rendered.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/**
 * The session is valid but lacks `scenarios:view` on the project.
 *
 * Shares its code, and therefore its copy, with the scenario-run CSV export:
 * one permission, one project, one thing to ask an administrator for. A second
 * code would be a second set of words saying the same sentence.
 */
export class RunReportForbiddenError extends HandledError {
  declare readonly code: "scenario_run_export_forbidden";

  constructor(projectId: string) {
    super(
      "scenario_run_export_forbidden",
      "You do not have permission to export run reports for this project.",
      {
        httpStatus: 403,
        meta: { projectId, permission: "scenarios:view" },
      },
    );
    this.name = "RunReportForbiddenError";
  }
}

/**
 * Too many reports with Langy started in the last minute.
 *
 * Carries the wait in `meta` rather than in a `Retry-After` header: the
 * boundary serialiser spreads meta flat into the body and has no channel for
 * response headers, and the caller here is a browser reading the body anyway.
 * The registry's copy turns the number into a sentence.
 *
 * Only the analysed export is limited, which is the other half of what the
 * customer needs to know, so the copy says so.
 */
export class RunReportRateLimitedError extends HandledError {
  declare readonly code: "scenario_run_report_rate_limited";

  constructor(retryAfterSeconds: number) {
    super(
      "scenario_run_report_rate_limited",
      "Too many run reports with analysis started in the last minute.",
      {
        httpStatus: 429,
        fault: "customer",
        meta: { retryAfterSeconds },
      },
    );
    this.name = "RunReportRateLimitedError";
  }
}

/**
 * The batch has no runs to report on.
 *
 * Its own code rather than the experiment runs' `run_not_found`, whose copy is
 * about a run polled after its status expired and would send a reader looking
 * for a retention problem they do not have.
 */
export class RunReportBatchNotFoundError extends HandledError {
  declare readonly code: "scenario_batch_run_not_found";

  constructor(
    batchRunId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("scenario_batch_run_not_found", "No runs found for this batch.", {
      httpStatus: 404,
      fault: "customer",
      meta: { batchRunId },
      ...options,
    });
    this.name = "RunReportBatchNotFoundError";
  }
}
