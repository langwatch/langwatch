// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** How a kill switch target is reached and how its refusal is named. */
import type { AgentStopTarget } from "@langwatch/enterprise-governance-contract";

/**
 * What a target acts on, whatever its plan row id: a plan save gives every row a new id, so a stop
 * and the plan are compared by this.
 */
export function targetKeyOf(target: AgentStopTarget): string {
  switch (target.kind) {
    case "databricks_serving_endpoint":
      return [target.kind, target.ingestionSourceId, target.endpointName].join("\u001f");
    case "bedrock_agent_alias":
      return [
        target.kind,
        target.awsConnectionId,
        target.region,
        target.agentId,
        target.agentAliasId,
      ].join("\u001f");
    case "gateway_virtual_key":
      return [target.kind, target.virtualKeyId].join("\u001f");
  }
}

/** A Databricks workspace as two sources naming it compare: its origin, in lower case. */
export function workspaceKeyOf(workspaceUrl: string): string {
  try {
    return new URL(workspaceUrl).origin.toLowerCase();
  } catch {
    return workspaceUrl.trim().replace(/\/+$/, "").toLowerCase();
  }
}

/** Whether `other` names the Bedrock alias `target` names, whichever AWS connection reaches it. */
export function isSameBedrockAlias({
  target,
  other,
}: {
  target: Extract<AgentStopTarget, { kind: "bedrock_agent_alias" }>;
  other: AgentStopTarget;
}): boolean {
  return (
    other.kind === "bedrock_agent_alias" &&
    other.region === target.region &&
    other.agentId === target.agentId &&
    other.agentAliasId === target.agentAliasId
  );
}

/** The endpoint's stop or start path, or the endpoint itself without an action. */
export function servingEndpointPath({
  endpointName,
  action,
}: {
  endpointName: string;
  action?: "stop" | "start";
}): string {
  const endpoint = `/api/2.0/serving-endpoints/${encodeURIComponent(endpointName)}`;
  return action ? `${endpoint}/config:${action}` : endpoint;
}

/** The invocation state a stop sets on a Bedrock agent alias, and the one a restore sets back. */
export const BEDROCK_INVOCATION_STATES = {
  stop: "REJECT_INVOCATIONS",
  restore: "ACCEPT_INVOCATIONS",
} as const;
export type BedrockInvocationState =
  (typeof BEDROCK_INVOCATION_STATES)[keyof typeof BEDROCK_INVOCATION_STATES];

/** The codes a platform answers for a resource that no longer exists (Databricks, Bedrock). */
const GONE_ERROR_CODES = new Set(["http_404", "ResourceNotFoundException"]);

/** A stop's first call found no such resource: a wrong region, account, id or name. */
export const TARGET_NOT_FOUND_ERROR_CODE = "target_not_found";
/** The target left the plan before its apply ran, so the platform was not called. */
export const TARGET_NOT_IN_PLAN_ERROR_CODE = "target_not_in_plan";

/** True when the target's resource was deleted: nothing is left to stop or restore. */
export function isGoneErrorCode(code: string): boolean {
  return GONE_ERROR_CODES.has(code);
}

/**
 * A stable code for what refused a target: the error's own `code` when it carries a string one
 * (`http_404`, a HandledError code), else its name (the AWS SDK names its exceptions), never prose.
 */
export function errorCodeOf(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const { code } = error;
    if (typeof code === "string" && code.length > 0) return code;
  }
  if (error instanceof Error && error.name && error.name !== "Error") return error.name;
  return "unknown_error";
}
