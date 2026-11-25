import type { SelfHostedNotice } from "@langwatch/ops-contract";

import type { CloudLatestRelease } from "../repositories/cloud-latest-release.repository.ts";

/** How a posted report came back: its status, the newest release and notices it named. */
export interface UsageReportPostAnswer {
  readonly status: number;
  readonly latestRelease: CloudLatestRelease | null;
  /** Each well-formed notice the reply named; a malformed one is dropped alone. */
  readonly notices: readonly SelfHostedNotice[];
}

/**
 * The daily usage report leaving the install for the app host or the connect
 * host. A post that reaches no host throws; one a host answered, whatever it
 * answered, resolves with the status.
 */
export interface UsageReportChannel {
  post(input: { endpoint: string; body: Record<string, unknown> }): Promise<UsageReportPostAnswer>;
}
