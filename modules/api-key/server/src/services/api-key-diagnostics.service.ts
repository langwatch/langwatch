import type { Logger } from "@langwatch/observability";

/** Where an API-key grant warning goes, declared beside what answers it. */
export interface ApiKeyDiagnostics {
  warn(context: Record<string, unknown>, message: string): void;
}

/**
 * Where an API-key grant warning goes.
 *
 * The legacy grant service warns rather than throws when a grant it expected
 * to revoke is already gone, so this is the only record that the fail-safe
 * path ran. The composing process supplies a named logger; nothing about which
 * name belongs to the feature.
 */
export class ApiKeyDiagnosticsAdapter implements ApiKeyDiagnostics {
  static create(logger: Pick<Logger, "warn">): ApiKeyDiagnosticsAdapter {
    return new ApiKeyDiagnosticsAdapter(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
  }

  warn(context: Record<string, unknown>, message: string): void {
    this.logger.warn(context, message);
  }
}
