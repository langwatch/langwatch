/**
 * The failure the CLI hands back to Langy. The worker returns the message
 * verbatim as the tool result, so it is written for the model to act on: what
 * was refused, and what would work instead.
 */

import type { LocalCallErrorCode } from "../../../agent/local-control-protocol";

export class LocalCallFailure extends Error {
  readonly code: LocalCallErrorCode;

  constructor({ code, message }: { code: LocalCallErrorCode; message: string }) {
    super(message);
    this.name = "LocalCallFailure";
    this.code = code;
  }
}

/** The failure as a message, whatever kind of error arrived. */
export const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The code to report for an error, defaulting to a failed execution. */
export const failureCode = (error: unknown): LocalCallErrorCode =>
  error instanceof LocalCallFailure ? error.code : "exec_failed";
