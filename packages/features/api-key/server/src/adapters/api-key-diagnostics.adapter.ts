import type { Logger } from "@langwatch/observability";
import { ApiKeyDiagnosticsPort } from "../ports/api-key-diagnostics.port";

/**
 * Where an API-key grant warning goes.
 *
 * The legacy grant service warns rather than throws when a grant it expected
 * to revoke is already gone, so this is the only record that the fail-safe
 * path ran. The composing process supplies a named logger; nothing about which
 * name belongs to the feature.
 */
export class ApiKeyDiagnosticsAdapter extends ApiKeyDiagnosticsPort {
  static create(logger: Pick<Logger, "warn">): ApiKeyDiagnosticsAdapter {
    return new ApiKeyDiagnosticsAdapter(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  warn(context: Record<string, unknown>, message: string): void {
    this.logger.warn(context, message);
  }
}
