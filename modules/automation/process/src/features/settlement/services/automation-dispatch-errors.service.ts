import { DispatchError } from "@langwatch/eventing";

import { AutomationDispatchError } from "../../graph-alert/services/automation-graph-activity.service.ts";

/** As main: only a DispatchError marked not retryable is terminal; anything else is retried. */
export class AutomationDispatchErrorsService extends AutomationDispatchError {
  static create(): AutomationDispatchErrorsService {
    return new AutomationDispatchErrorsService();
  }

  private constructor() {
    super();
  }

  isTerminal(error: unknown): boolean {
    return error instanceof DispatchError && !error.retryable;
  }

  createTerminal(message: string): unknown {
    return new DispatchError({ message, retryable: false });
  }
}
