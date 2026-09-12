/**
 * The one guidance text that tells a coding-agent session when to declare its
 * working context. Every channel carries this same constant, so the words a
 * claude session reads, the words a codex session reads and the words the
 * docs quote can never drift apart:
 *
 *   - `langwatch ingest guidance claude-code` prints it as SessionStart
 *     additionalContext JSON, run by the claude plugin's launcher
 *     (`plugins/langwatch/scripts/launch.mjs`) and by the raw claude settings
 *     hooks for installs without plugin support,
 *   - the codex global AGENTS.md carries it in a marker-managed block
 *     (`codex-agents-md.ts`), because codex has no plugin channel for
 *     always-loaded context.
 *
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
