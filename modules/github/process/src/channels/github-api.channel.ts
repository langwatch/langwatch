import type { Instant } from "@langwatch/time";

/** The installation this App JWT asked GitHub for is gone or was never granted. */
export class GithubInstallationNotFoundError extends Error {
  readonly installationId: string;

  constructor(installationId: string) {
    super(`GitHub installation ${installationId} not found`);
    this.name = "GithubInstallationNotFoundError";
    this.installationId = installationId;
  }
}

/** GitHub refused the call for rate limiting; the headers say when to retry. */
export class GithubRateLimitedError extends Error {
  readonly retryAfterSec: number | null;
  readonly resetAt: Instant | null;

  constructor(input: { retryAfterSec: number | null; resetAt: Instant | null }) {
    super("GitHub rate limit reached");
    this.name = "GithubRateLimitedError";
    this.retryAfterSec = input.retryAfterSec;
    this.resetAt = input.resetAt;
  }
}
