// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The codes LangWatch raises itself before or after a platform call, beside the platform's own. */
const KILL_SWITCH_PLATFORM_CODES = [
  "aws_connection_incomplete",
  "aws_external_id_missing",
  "bedrock_alias_state_unknown",
  "bedrock_alias_unreadable",
  "source_not_configured",
] as const;

/**
 * What a stop records for a refused call: one of LangWatch's own codes, Databricks' HTTP status
 * (`http_404`) or the name of a Bedrock exception (`ResourceNotFoundException`).
 */
export type KillSwitchPlatformCode =
  | (typeof KILL_SWITCH_PLATFORM_CODES)[number]
  | `http_${number}`
  | `${string}Exception`;

/** The code of a Databricks answer that was not 2xx. */
export function httpPlatformCodeOf(status: number): KillSwitchPlatformCode {
  return `http_${status}`;
}

/** A platform refused a kill switch call: the stop records `code`; the message is logged only. */
export class KillSwitchPlatformError extends Error {
  readonly code: KillSwitchPlatformCode;

  constructor({ code, message }: { code: KillSwitchPlatformCode; message: string }) {
    super(message);
    this.name = "KillSwitchPlatformError";
    this.code = code;
  }
}
