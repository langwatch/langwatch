import type { Logger } from "@langwatch/observability";
import { PersonalWorkspaceDiagnostics } from "../app/organization.infrastructure.ts";

/**
 * Where a personal-workspace warning goes. The port takes `(message, context)` and the
 * repository's logger takes `(context, message)`; this adapter does that swap once.
 */
export class PersonalWorkspaceDiagnosticsAdapter implements PersonalWorkspaceDiagnostics {
  static create(logger: Pick<Logger, "warn">): PersonalWorkspaceDiagnosticsAdapter {
    return new PersonalWorkspaceDiagnosticsAdapter(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
  }

  warn(message: string, context: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }
}
