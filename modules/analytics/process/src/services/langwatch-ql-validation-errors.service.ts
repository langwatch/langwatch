import {
  LangWatchQLUnparseableError,
  LangWatchQLNotPermittedError,
} from "@langwatch/analytics-contract";
import type { HandledError } from "@langwatch/handled-error";

import type { RejectedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";

/** Names a refusal from the validator as the handled error the boundary ships. */
export class LangWatchQLValidationErrorService {
  static create(): LangWatchQLValidationErrorService {
    return new LangWatchQLValidationErrorService();
  }

  private constructor() {}

  /**
   * Turns a rejection into the handled error for it.
   */
  forRejection(rejection: RejectedLangWatchQL): HandledError {
    const unparseable = rejection.violations.every(
      (violation) => violation.code === "PARSE_FAILED",
    );

    return unparseable
      ? new LangWatchQLUnparseableError(rejection.violations)
      : new LangWatchQLNotPermittedError(rejection.violations);
  }
}
