import type { GovernanceDiagnosticsSink } from "../app/governance.infrastructure.ts";

export class NullGovernanceDiagnosticsAdapter implements GovernanceDiagnosticsSink {
  warn(): void {}
}
