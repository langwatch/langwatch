import type { IngestionPullDiagnosticsSink } from "../app/governance.infrastructure.ts";

export class NullIngestionPullDiagnosticsAdapter implements IngestionPullDiagnosticsSink {
  info(): void {}
  warn(): void {}
  error(): void {}
  capture(): void {}
}
