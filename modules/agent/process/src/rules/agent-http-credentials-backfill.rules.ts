import { isZodLikeError } from "@langwatch/handled-error";

/** Why the credential step left an agent's literal where it is; a retry never changes these. */
export type AgentCredentialKeptReason =
  | "project_not_found"
  | "project_has_no_member"
  | "agent_not_found"
  | "secret_limit_reached"
  | "secret_unreadable"
  | "secret_name_reserved"
  | "secret_name_taken"
  | "config_invalid";

/** One agent the credential step did not move, by id and a stable reason code. */
export type AgentCredentialOutcome = { agentId: string; projectId: string; reason: string };

/** Keyed by handled code, compared by value: a peer's error may have crossed a boundary. */
const KEPT_REASON_BY_CODE: Readonly<Record<string, AgentCredentialKeptReason>> = {
  // A secret write resolves the project's team to attribute it; an orphan project has none.
  secret_not_found: "project_not_found",
  authenticated_actor_required: "project_has_no_member",
  agent_not_found: "agent_not_found",
  secret_limit_reached: "secret_limit_reached",
  secret_unreadable: "secret_unreadable",
  secret_name_reserved: "secret_name_reserved",
  secret_already_exists: "secret_name_taken",
};

/** The handled code an error carries, or nothing for an unhandled one. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;

  return typeof error.code === "string" ? error.code : undefined;
}

/** The permanent reason behind a failed move, or undefined when a retry may succeed. */
export function keptReasonOf(error: unknown): AgentCredentialKeptReason | undefined {
  if (isZodLikeError(error)) return "config_invalid";
  const code = codeOf(error);

  return code === undefined ? undefined : KEPT_REASON_BY_CODE[code];
}

/** The error's code or kind only: a message may echo the value being stored. */
export function failureReasonOf(error: unknown): string {
  const code = codeOf(error);
  if (code !== undefined) return code;

  return error instanceof Error ? error.name : typeof error;
}

const NAMED_IN_MESSAGE = 5;

/** The step's failure message, naming each held agent and why, the first few in full. */
export function heldMessageOf(failed: readonly AgentCredentialOutcome[]): string {
  const named = failed
    .slice(0, NAMED_IN_MESSAGE)
    .map(({ agentId, projectId, reason }) => `agent ${agentId} in project ${projectId}: ${reason}`);
  const more = failed.length - named.length;

  return (
    `${failed.length} HTTP agent credential(s) could not be stored as project secrets ` +
    `(${named.join("; ")}${more > 0 ? `; and ${more} more` : ""}). ` +
    "Retry the step once the cause is fixed."
  );
}
