import { HandledError } from "@langwatch/handled-error";

export type UpgradeReadErrorCode = "upgrade_not_found" | "upgrade_invalid_cursor";

const HTTP_STATUS: Record<UpgradeReadErrorCode, number> = {
  upgrade_not_found: 404,
  upgrade_invalid_cursor: 400,
};

/** A read the ledger cannot answer. Consumers branch on `code`, never on the message. */
export class UpgradeReadError extends HandledError {
  declare readonly code: UpgradeReadErrorCode;

  constructor(code: UpgradeReadErrorCode, message: string) {
    super(code, message, { httpStatus: HTTP_STATUS[code], fault: "customer" });
    this.name = "UpgradeReadError";
  }
}
