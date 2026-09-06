import type { Logger } from "@langwatch/observability";
import { PersonalWorkspaceDiagnosticsPort } from "../ports/organization.port";

/**
 * Where a personal-workspace warning goes. The port takes `(message, context)` and the
 * repository's logger takes `(context, message)`; this adapter does that swap once.
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
