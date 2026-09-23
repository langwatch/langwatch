/** How a posted report came back: the status is what an operator acts on; the body is unread. */
export interface UsageReportPostAnswer {
  readonly status: number;
}

/**
 * The daily usage report leaving the install for the app host or the connect
 * host. A post that reaches no host throws; one a host answered, whatever it
 * answered, resolves with the status.
 */
export interface UsageReportChannel {
  post(input: { endpoint: string; body: Record<string, unknown> }): Promise<UsageReportPostAnswer>;
}
