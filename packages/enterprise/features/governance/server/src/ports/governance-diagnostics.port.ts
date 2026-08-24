export abstract class GovernanceDiagnosticsPort {
  abstract warn(message: string, context: Record<string, unknown>): void;
}

export class NullGovernanceDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(): void {}
}
