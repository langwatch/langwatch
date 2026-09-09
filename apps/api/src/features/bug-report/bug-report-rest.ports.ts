/**
 * What the public report intake reaches on this process. The family's own
 * transport moved into the ops module's application, so the shape the
 * composition still fills is stated here, beside the process that fills it.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type {
  BugReportNotifier,
  BugReportRateLimiter,
  BugReportRepository,
} from "@langwatch/ops-server";

/** Reads the optional project credential off a report request. */
export type BugReportRestCredentialReader = (
  request: Request,
) => Readonly<{ token: string; projectId: string | null }> | null;

/** Everything the intake reaches that the report itself does not own. */
export type BugReportRestPorts = Readonly<{
  /** Where a filed report is written. */
  reports: () => BugReportRepository;
  /** The deployment's fixed-window counter, keyed on the nearest-hop IP. */
  rateLimiter: BugReportRateLimiter;
  /** Where the team is alerted. Best-effort; intake already succeeded. */
  notifier: BugReportNotifier;
  /** Reads the optional project credential off the request. */
  credentials: BugReportRestCredentialReader;
  /**
   * Resolves that credential to a project, where this process has a directory
   * to resolve it through. Absent means every report files unlinked, which is
   * the same degradation an invalid key already produces.
   */
  apiKeys?: (() => ApiKeyApi) | undefined;
}>;
