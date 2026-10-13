/** One attempt counted against a scope's window; `resetAt` feeds a refusal's `Retry-After`. */
export interface WebhookDispatchCapCount {
  allowed: boolean;
  remaining: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
}

/** The counter the hourly dispatch cap is kept in, shared by every dispatching process. */
export interface WebhookDispatchCapRepository {
  /** Counts one attempt against `scopeId` and says whether it is inside `max` for the window. */
  countAttempt(input: {
    scopeId: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchCapCount>;
}
