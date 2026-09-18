import type { Logger } from "@langwatch/observability";

/** Where an API-key grant warning goes, declared beside what answers it. */
export interface ApiKeyDiagnostics {
  warn(context: Record<string, unknown>, message: string): void;
}

/**
 * Where an API-key grant warning goes. The legacy grant service warns
 * rather than throws when an expected revoke is already gone, so this is
 * the only record the fail-safe path ran; the process supplies a named logger.
 */
export class ApiKeyDiagnosticsAdapter implements ApiKeyDiagnostics {
  static create(logger: Pick<Logger, "warn">): ApiKeyDiagnosticsAdapter {
    return new ApiKeyDiagnosticsAdapter(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {}

  warn(context: Record<string, unknown>, message: string): void {
    this.logger.warn(context, message);
  }
}
