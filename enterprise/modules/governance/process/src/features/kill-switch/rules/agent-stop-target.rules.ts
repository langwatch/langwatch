// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** How a kill switch target is reached and how its refusal is named. */

export function servingEndpointPath({
  endpointName,
  action,
}: {
  endpointName: string;
  action: "stop" | "start";
}): string {
  return `/api/2.0/serving-endpoints/${encodeURIComponent(endpointName)}/config:${action}`;
}

/** The invocation state a stop sets on a Bedrock agent alias, and the one a restore sets back. */
export const BEDROCK_INVOCATION_STATES = {
  stop: "REJECT_INVOCATIONS",
  restore: "ACCEPT_INVOCATIONS",
} as const;
export type BedrockInvocationState =
  (typeof BEDROCK_INVOCATION_STATES)[keyof typeof BEDROCK_INVOCATION_STATES];

/**
 * A stable code for what refused a target: the error's own `code` when it carries a string one
 * (`http_404`, a HandledError code), else its name (the AWS SDK names its exceptions), never prose.
 */
/** The codes a platform answers for a resource that no longer exists (Databricks, Bedrock). */
const GONE_ERROR_CODES = new Set(["http_404", "ResourceNotFoundException"]);

/** True when the target's resource was deleted: nothing is left to stop or restore. */
export function isGoneErrorCode(code: string): boolean {
  return GONE_ERROR_CODES.has(code);
}

export function errorCodeOf(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const { code } = error;
    if (typeof code === "string" && code.length > 0) return code;
  }
  if (error instanceof Error && error.name && error.name !== "Error") return error.name;
  return "unknown_error";
}
