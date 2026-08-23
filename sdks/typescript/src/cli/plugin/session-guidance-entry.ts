/**
 * The guidance hook as the LangWatch agent plugin ships it: a SessionStart
 * hook that injects the declare-your-context guidance into the session.
 *
 * The deliberate opposite of the session-context hook beside it: that one
 * must never write stdout, this one exists ONLY to write stdout, because a
 * SessionStart hook's `additionalContext` output is the one plugin channel
 * Claude Code loads into the session's own context (a CLAUDE.md at the
 * plugin root is not loaded). One JSON object, then exit zero.
 *
 * Imports only the guidance constant, so the bundle stays a few lines and
 * the words a plugin session reads are the words every other channel reads.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import { SESSION_CONTEXT_GUIDANCE } from "@/cli/utils/governance/session-guidance";

/**
 * The same misattribution gate the session-context entry applies: Agent
 * Plugins clients other than Claude Code load this package too, and guidance
 * JSON on stdout means nothing to them. Claude Code publishes these markers
 * into everything it spawns, hooks included.
 */
const CLAUDE_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PROJECT_DIR",
] as const;

const isInsideClaude = CLAUDE_MARKERS.some(
  (marker) => (process.env[marker]?.trim() ?? "") !== "",
);

if (isInsideClaude) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: SESSION_CONTEXT_GUIDANCE,
      },
    })}\n`,
  );
}

// A hook is never allowed to be why a session broke.
process.exit(0);
