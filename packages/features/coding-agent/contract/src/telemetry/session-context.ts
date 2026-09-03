import type { ContributionFacts } from "../coding-agent-processing";

/**
 * The LangWatch session-context vocabulary: the companion event a `langwatch
 * ingest context` declaration arrives as, and the keys its git identity rides
 * on. Agent-generic by construction — every agent that installs the hook sends
 * these exact spellings. Shared by the session fold (which keeps the session
 * row's present-tense identity) and the contribute command (which stamps each
 * fact row with the context active when it happened).
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
 * The working context a declaration names: which repository and branch the
 * session is on right now. The worktree is deliberately absent — attribution
 * matches pull requests on repository and branch, and the worktree names a
 * checkout, not a destination.
 */
export interface SessionWorkingContext {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
}

/**
 * The declared context off a `session_context` contribution's facts, or null
 * when the declaration names no repository. A partial answer (repository
 * without a branch, as on a detached HEAD) still returns, with the missing
 * field empty; the stamper decides whether that is enough to stamp with.
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

function str(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  return String(value);
}
