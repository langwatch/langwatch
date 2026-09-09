export abstract class ApiKeyDiagnosticsPort {
  abstract warn(context: Record<string, unknown>, message: string): void;
}
