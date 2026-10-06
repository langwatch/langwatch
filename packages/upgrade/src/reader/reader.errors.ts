export type UpgradeReadErrorCode = "upgrade_not_found" | "upgrade_invalid_cursor";

/** A read the ledger cannot answer. Consumers branch on `code`, never on the message. */
export class UpgradeReadError extends Error {
  constructor(
    readonly code: UpgradeReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UpgradeReadError";
  }
}
