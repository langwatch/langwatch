import type { CloudLatestRelease } from "../repositories/cloud-latest-release.repository.ts";

/** How a posted report came back: its status, and the newest release the reply named, if any. */
export interface UsageReportPostAnswer {
  readonly status: number;
  readonly latestRelease: CloudLatestRelease | null;
}

/**
 * The daily usage report leaving the install for the app host or the connect
 * host. A post that reaches no host throws; one a host answered, whatever it
 * answered, resolves with the status.
 */
export interface UsageReportChannel {
  post(input: { endpoint: string; body: Record<string, unknown> }): Promise<UsageReportPostAnswer>;
}
