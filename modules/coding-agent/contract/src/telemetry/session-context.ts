import type { ContributionFacts } from "../coding-agent-processing.ts";

/**
 * The LangWatch session-context vocabulary: the event a `langwatch ingest
 * context` declaration arrives as, and the keys its git identity rides on.
 * Agent-generic — every agent installing the hook sends these exact spellings.
 */
export const SESSION_CONTEXT_EVENT = "session_context";

export const SESSION_CONTEXT_ATTR = {
  REPOSITORY_HOST: "vcs.repository.host",
  REPOSITORY_OWNER: "vcs.repository.owner",
  REPOSITORY_NAME: "vcs.repository.name",
  BRANCH: "vcs.ref.head.name",
  WORKTREE: "vcs.worktree.name",
} as const;

/**
 * The working context a declaration names: repository and branch. Worktree
 * is deliberately absent — attribution matches on repository/branch, and
 * worktree names a checkout, not a destination.
 */
export interface SessionWorkingContext {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
}

/**
 * The declared context off a `session_context` contribution, or null when it
 * names no repository. A partial answer (repository without branch, as on a
 * detached HEAD) still returns, empty field and all — the stamper decides.
 */
export function workingContextOfFacts(facts: ContributionFacts): SessionWorkingContext | null {
  const context = {
    repositoryHost: str(facts[SESSION_CONTEXT_ATTR.REPOSITORY_HOST]),
    repositoryOwner: str(facts[SESSION_CONTEXT_ATTR.REPOSITORY_OWNER]),
    repositoryName: str(facts[SESSION_CONTEXT_ATTR.REPOSITORY_NAME]),
    branch: str(facts[SESSION_CONTEXT_ATTR.BRANCH]),
  };
  if (context.repositoryOwner === "" || context.repositoryName === "") {
    return null;
  }
  return context;
}

export function isStampableContext(context: SessionWorkingContext): boolean {
  return (
    context.repositoryHost !== "" &&
    context.repositoryOwner !== "" &&
    context.repositoryName !== "" &&
    context.branch !== ""
  );
}

/**
 * The context a stamped contribution carries, or null when it carries none.
 * Stamps are written all-or-nothing, so any missing field means the whole
 * stamp is absent; checking each keeps a partial stamp from ever reading as
 * a context.
 */
export function stampedContextOf(stamp: {
  repositoryHost?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
}): SessionWorkingContext | null {
  const context = {
    repositoryHost: stamp.repositoryHost ?? "",
    repositoryOwner: stamp.repositoryOwner ?? "",
    repositoryName: stamp.repositoryName ?? "",
    branch: stamp.branch ?? "",
  };
  return isStampableContext(context) ? context : null;
}

function str(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  return String(value);
}
