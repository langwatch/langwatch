/**
 * The one guidance text that tells a coding-agent session when to declare its working context.
 * Every channel carries this same constant, so claude, codex and the docs can never drift apart:
 * `langwatch ingest guidance claude-code` prints it as SessionStart additionalContext JSON (the
 * claude plugin launcher and the raw settings hooks), and the codex global AGENTS.md carries it
 * in a marker-managed block (`codex-agents-md.ts`), since codex has no plugin channel.
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

/**
 * Written to the agent, not the user: it is injected into the session's own
 * context, and the agent is the one who has to act on it mid-session.
 */
export const SESSION_CONTEXT_GUIDANCE =
  "LangWatch attributes this session's work and cost to the repository and " +
  "branch it reports. When you start work in a different repository, branch " +
  "or worktree (you cd into another checkout, run git checkout or git " +
  "switch, or create a worktree), run `langwatch ingest context` from " +
  "inside that directory. It prints one line, never interrupts the session, " +
  "and is what attributes your work to the correct pull request.";
