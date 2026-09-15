import type { IngestionPullDiagnosticsSink } from "../app/governance.members.ts";

export class NullIngestionPullDiagnosticsAdapter implements IngestionPullDiagnosticsSink {
  info(): void {}
  warn(): void {}
  error(): void {}
  capture(): void {}
}
