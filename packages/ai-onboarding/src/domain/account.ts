import type {
  AccountRef,
  AccountState,
  AgentSlug,
  Lifecycle,
} from "@langwatch/contracts/agent-onboarding";

/**
 * An account provisioned without an identity, and the two deadlines that
 * govern it until one is attached.
 *
 * Both deadlines are nullable rather than absent-when-claimed so that claiming
 * is a single UPDATE that nulls them — the reaper's work list is
 * `deleteAfter IS NOT NULL AND deleteAfter <= now`, which a claimed row can
 * never match.
 */
export interface EphemeralAccount {
  id: string;
  organizationId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  agent: AgentSlug;
  provisionedAt: Date;
  ingestionStopsAt: Date | null;
  deleteAfter: Date | null;
  claimedAt: Date | null;
  claimedByUserId: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The account's phase, computed from its timestamps every time it is asked
 * for.
 *
 * Not a stored column on purpose: a state field is a second source of truth
 * that goes stale the moment a background job is late, and this value backs a
 * countdown a developer reads in their terminal.
 */
export function deriveState(
  account: Pick<
    EphemeralAccount,
    "ingestionStopsAt" | "deleteAfter" | "claimedAt"
  >,
  now: Date,
): AccountState {
  if (account.claimedAt !== null) return "claimed";
  if (account.deleteAfter !== null && now >= account.deleteAfter) {
    return "expired";
  }
  if (account.ingestionStopsAt !== null && now >= account.ingestionStopsAt) {
    return "read_only";
  }
  return "active";
}

/**
 * Whole days left in the current phase, rounded up so a CLI never prints
 * "0 days left" while the account still works. Null when there is no
 * countdown to show — claimed accounts have no deadline, expired ones have
 * nothing left to count.
 */
export function daysRemainingInPhase(
  account: Pick<
    EphemeralAccount,
    "ingestionStopsAt" | "deleteAfter" | "claimedAt"
  >,
  now: Date,
): number | null {
  const state = deriveState(account, now);
  const deadline =
    state === "active"
      ? account.ingestionStopsAt
      : state === "read_only"
        ? account.deleteAfter
        : null;
  if (deadline === null) return null;
  return Math.max(
    0,
    Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_DAY),
  );
}

export function toLifecycle(account: EphemeralAccount, now: Date): Lifecycle {
  return {
    state: deriveState(account, now),
    provisionedAt: account.provisionedAt.toISOString(),
    ingestionStopsAt: account.ingestionStopsAt?.toISOString() ?? null,
    deleteAfter: account.deleteAfter?.toISOString() ?? null,
    daysRemainingInPhase: daysRemainingInPhase(account, now),
  };
}

export function toAccountRef(account: EphemeralAccount): AccountRef {
  return {
    organizationId: account.organizationId,
    projectId: account.projectId,
    projectSlug: account.projectSlug,
    projectName: account.projectName,
  };
}

/** Deadlines for a freshly provisioned account. */
export function computeDeadlines(params: {
  provisionedAt: Date;
  ingestionDays: number;
  retentionDays: number;
}): { ingestionStopsAt: Date; deleteAfter: Date } {
  const base = params.provisionedAt.getTime();
  return {
    ingestionStopsAt: new Date(base + params.ingestionDays * MS_PER_DAY),
    deleteAfter: new Date(base + params.retentionDays * MS_PER_DAY),
  };
}

/** Default project name when the caller didn't pick one. */
export function defaultProjectName(agent: AgentSlug): string {
  const labels: Record<AgentSlug, string> = {
    claude_code: "Claude Code",
    claude_cowork: "Claude Cowork",
    codex: "Codex",
    gemini: "Gemini",
    opencode: "OpenCode",
  };
  return labels[agent];
}
