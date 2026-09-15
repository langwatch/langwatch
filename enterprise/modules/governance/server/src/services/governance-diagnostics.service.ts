import type { GovernanceDiagnosticsSink } from "../app/governance.members.ts";

export class NullGovernanceDiagnosticsAdapter implements GovernanceDiagnosticsSink {
  warn(): void {}
}
