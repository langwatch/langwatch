/**
 * Fixed-window counter for the PUBLIC report endpoint. The bucket key is the
 * nearest-hop IP, which the caller asserts, so this is a flood bound rather
 * than an authorization: the deployment's own counter decides, and its absence
 * would let one client fill a cross-tenant inbox.
 */
export abstract class BugReportRateLimiterPort {
  abstract consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean }>;
}
