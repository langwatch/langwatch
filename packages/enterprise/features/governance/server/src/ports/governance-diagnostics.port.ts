export abstract class GovernanceDiagnosticsPort {
  abstract warn(message: string, context: Record<string, unknown>): void;
}

export class NullGovernanceDiagnosticsAdapter extends GovernanceDiagnosticsPort {
  warn(): void {}
}
