export const steppingErrorCodes = [
  "duplicate_folder",
  "missing_migration_sql",
  "invalid_goose_version",
] as const;

/** A release the applier refuses before it runs any tool; `code` is what a caller branches on. */
export class SteppingError extends Error {
  readonly code: (typeof steppingErrorCodes)[number];

  constructor({ code, message }: { code: SteppingError["code"]; message: string }) {
    super(message);
    this.name = "SteppingError";
    this.code = code;
  }
}
