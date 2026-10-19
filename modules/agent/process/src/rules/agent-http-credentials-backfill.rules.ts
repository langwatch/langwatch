/** Kept means no action can ever make the move possible; anything an operator can fix is held. */
export type AgentCredentialKeptReason =
  | "project_not_found"
  | "agent_not_found"
  | "secret_name_reserved"
  | "config_invalid";

/** A refusal an operator can fix (free a slot, add a member, rotate a secret): fails the step. */
type AgentCredentialHeldReason =
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

/** The handled code an error carries; an unhandled one carries none. */
type HandledCode = { kind: "handled"; code: string } | { kind: "unhandled" };

function handledCodeOf(error: unknown): HandledCode {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return { kind: "unhandled" };
  }

  return typeof error.code === "string"
    ? { kind: "handled", code: error.code }
    : { kind: "unhandled" };
}

/** A failed move: kept for good, or held with its code or kind (never its message). */
export type MoveFailure =
  | { kind: "kept"; reason: AgentCredentialKeptReason }
  | { kind: "held"; reason: string };

/**
 * A schema error is never kept here: the service checks the stored config (`config_invalid`)
 * before the move, so one thrown later is our own bug and holds the step.
 */
export function moveFailureOf(error: unknown): MoveFailure {
  const handled = handledCodeOf(error);
  if (handled.kind === "unhandled") {
    return { kind: "held", reason: error instanceof Error ? error.name : typeof error };
  }
  const kept = KEPT_REASON_BY_CODE[handled.code];
  if (kept !== undefined) return { kind: "kept", reason: kept };

  return { kind: "held", reason: HELD_REASON_BY_CODE[handled.code] ?? handled.code };
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
