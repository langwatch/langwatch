/**
 * What a screen reported since it was last asked. Per-step on purpose: an
 * error attributed to the next step sends a reader to the wrong screenshot.
 */
export class StepRecorder {
  private consoleErrors: string[] = [];
  private failedRequests: string[] = [];

  consoleError(text: string): void {
    this.consoleErrors.push(shorten(text));
  }

  failedRequest(text: string): void {
    this.failedRequests.push(shorten(text, 200));
  }

  /** drain hands back everything recorded since the last drain, and forgets it. */
  drain(): { consoleErrors: string[]; failedRequests: string[] } {
    const drained = { consoleErrors: this.consoleErrors, failedRequests: this.failedRequests };
    this.consoleErrors = [];
    this.failedRequests = [];
    return drained;
  }
}

const shorten = (value: string, limit = 300): string => value.replace(/\s+/g, " ").slice(0, limit);
