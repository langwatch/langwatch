import type { Logger } from "@langwatch/observability";
import { PersonalWorkspaceDiagnosticsPort } from "../ports/organization.port";

/**
 * Where a personal-workspace warning goes.
 *
 * The port takes `(message, context)` and the repository's logger takes
 * `(context, message)`; swapping the two silently produces a log line whose
 * message is `[object Object]`, which is the kind of defect that is only found
 * when somebody needs the line. Doing the swap once, here, is the point of the
 * adapter — the composing process supplies a named logger and nothing else.
 */
export class PersonalWorkspaceDiagnosticsAdapter extends PersonalWorkspaceDiagnosticsPort {
  static create(logger: Pick<Logger, "warn">): PersonalWorkspaceDiagnosticsAdapter {
    return new PersonalWorkspaceDiagnosticsAdapter(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  warn(message: string, context: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }
}
