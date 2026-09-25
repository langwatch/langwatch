import type { Logger } from "@langwatch/observability";

import { type PersonalWorkspaceDiagnostics } from "../app/organization.members.ts";

/**
 * Where a personal-workspace warning goes. The port takes `(message, context)` and the
 * repository's logger takes `(context, message)`; this service does that swap once.
 */
export class PersonalWorkspaceDiagnosticsService implements PersonalWorkspaceDiagnostics {
  static create(logger: Pick<Logger, "warn">): PersonalWorkspaceDiagnosticsService {
    return new PersonalWorkspaceDiagnosticsService(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {}

  warn(message: string, context: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }
}
