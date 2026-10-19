/** Kept means no action can ever make the move possible; anything an operator can fix is held. */
export type AgentCredentialKeptReason =
  | "project_not_found"
  | "agent_not_found"
  | "secret_name_reserved"
  | "config_invalid";

/** A refusal an operator can fix (free a slot, add a member, rotate a secret); it fails the step. */
export type AgentCredentialHeldReason =
  | "project_has_no_member"
  | "secret_limit_reached"
  | "secret_unreadable"
  | "secret_name_taken";

/** One agent the credential step did not move, by id and a stable reason code. */
export type AgentCredentialOutcome = { agentId: string; projectId: string; reason: string };

/** Keyed by handled code, compared by value: a peer's error may have crossed a boundary. */
const KEPT_REASON_BY_CODE: Readonly<Record<string, AgentCredentialKeptReason>> = {
  // A secret write resolves the project's team to attribute it; an orphan project has none.
  secret_not_found: "project_not_found",
  agent_not_found: "agent_not_found",
  // Names derive from the agent's immutable id and the reserved list is code.
  secret_name_reserved: "secret_name_reserved",
};

const HELD_REASON_BY_CODE: Readonly<Record<string, AgentCredentialHeldReason>> = {
  authenticated_actor_required: "project_has_no_member",
  secret_limit_reached: "secret_limit_reached",
  secret_unreadable: "secret_unreadable",
  secret_already_exists: "secret_name_taken",
};

/** The handled code an error carries, or nothing for an unhandled one. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;

  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * The permanent reason behind a failed move, or undefined when a retry or a fix may succeed. A schema
 * error is deliberately not here: where it happened decides, and the service classifies the
 * agent's stored config (`config_invalid`) before the move; one thrown later is our own bug.
 */
export function keptReasonOf(error: unknown): AgentCredentialKeptReason | undefined {
  const code = codeOf(error);

  return code === undefined ? undefined : KEPT_REASON_BY_CODE[code];
}

/** The error's reason, code or kind only: a message may echo the value being stored. */
export function failureReasonOf(error: unknown): string {
  const code = codeOf(error);
  if (code !== undefined) return HELD_REASON_BY_CODE[code] ?? code;

  return error instanceof Error ? error.name : typeof error;
}

const NAMED_IN_MESSAGE = 5;

/** The step's failure message, naming the first few held agents and why; `held` counts all. */
export function heldMessageOf({
  failed,
  held,
}: {
  failed: readonly AgentCredentialOutcome[];
  held: number;
}): string {
  const named = failed
    .slice(0, NAMED_IN_MESSAGE)
    .map(({ agentId, projectId, reason }) => `agent ${agentId} in project ${projectId}: ${reason}`);
  const more = held - named.length;

  return (
    `${held} HTTP agent credential(s) could not be stored as project secrets ` +
    `(${named.join("; ")}${more > 0 ? `; and ${more} more` : ""}). ` +
    "Retry the step once the cause is fixed."
  );
}
