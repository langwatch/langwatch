import { AutomationDispatchError } from "./automation-graph-activity.service.ts";

/**
 * Retryable versus terminal, for a process with no queue: every failure
 * reads as terminal, since one called retryable here would simply be lost.
 */
export class AutomationDispatchErrorsTerminalService extends AutomationDispatchError {
  static create(): AutomationDispatchErrorsTerminalService {
    return new AutomationDispatchErrorsTerminalService();
  }

  private constructor() {
    super();
  }

  isTerminal(): boolean {
    return true;
  }

  createTerminal(message: string): unknown {
    return new Error(message);
  }
}
