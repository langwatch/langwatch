export type BugReportRateLimitWindow = Readonly<{
  key: string;
  windowSeconds: number;
  max: number;
}>;

/** Fixed-window counters for the public report intake, one bucket per caller. */
export interface BugReportRateLimitRepository {
  consume(window: BugReportRateLimitWindow): Promise<Readonly<{ allowed: boolean }>>;
}
