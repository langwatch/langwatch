/**
 * The session context hook as the LangWatch agent plugin ships it: one
 * zero-dependency file, bundled from this entry and copied into the plugin's
 * `scripts/` directory.
 *
 * The plugin exists so a session's git context is captured without anything on
 * PATH, which is also why this cannot simply shell out to `langwatch ingest
 * hook`. A plugin installed today has to keep working when the user upgrades,
 * downgrades or uninstalls the global CLI, so the code it runs travels with it
 * and is pinned to the plugin's own version.
 *
 * It runs the same `hookCommand` the CLI does rather than a copy of it: every
 * rule that command obeys (nothing on stdout, always exit zero, every wait
 * bounded) is inherited rather than reimplemented, and the record a plugin
 * session posts is the record a CLI-installed session posts.
 *
 * WHAT THIS ADDS ON TOP: the misattribution gate below. Agent Plugins clients
 * other than Claude Code load this package too, and some discover the
 * `.claude-plugin` directory in it. Without the gate, a Codex or opencode
 * session would run the Claude Code hook and file its work under `claude_code`,
 * against a session id Claude Code never issued.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import { hookCommand } from "@/cli/commands/ingestion/hook";

/** The agent the hooks this plugin ships declare. */
const DEFAULT_TOOL = "claude-code";

/**
 * How a session proves which agent it belongs to.
 *
 * Only Claude Code is listed because only Claude Code publishes a marker: it
 * exports `CLAUDECODE` into everything it spawns, and its hooks additionally
 * see the session id and the project directory. A tool argument with no entry
 * here is not gated, since there would be nothing to check it against.
 *
 * This proves the session is a Claude Code one, not that it is THIS Claude Code
 * session: a nested agent launched from inside a Claude Code session inherits
 * the same variables. That nesting is the ambiguity `hookCommand` already
 * documents around `CLAUDE_CODE_SESSION_ID`, and the gate narrows it rather
 * than resolving it.
 */
const AGENT_MARKERS: Record<string, readonly string[]> = {
  claude_code: ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_PROJECT_DIR"],
};

const normalize = (tool: string): string => tool.trim().toLowerCase().replace(/-/g, "_");

/** Whether this process is running inside the agent it was told to report as. */
function runningInsideAgent({ tool, env }: { tool: string; env: NodeJS.ProcessEnv }): boolean {
  const markers = AGENT_MARKERS[normalize(tool)];
  if (!markers) return true;
  return markers.some((marker) => (env[marker]?.trim() ?? "") !== "");
}

async function main(): Promise<void> {
  // A blank argument reads the same as an absent one: the plugin always passes
  // the agent name, so anything else came from a hand-edited hook entry.
  const requested = process.argv[2]?.trim() ?? "";
  const tool = requested === "" ? DEFAULT_TOOL : requested;

  // Checked before stdin is read and before any other work: a session that is
  // not this agent's has nothing to report, and must not spend the payload
  // deadline discovering that.
  if (!runningInsideAgent({ tool, env: process.env })) return;

  await hookCommand({ tool });
}

// A hook is never allowed to be why a session broke, so every path out of here
// is a quiet zero. `hookCommand` already swallows its own failures; this is the
// backstop for the gate, the argv read and anything the runtime raises before
// either runs.
main()
  .catch(() => undefined)
  .finally(() => {
    // Explicit rather than implied, and an exit rather than a code: the OTLP
    // post rides on `fetch`, whose connection pool can keep the event loop
    // alive for seconds after the response is in hand. The agent is waiting on
    // this process before it lets the session continue.
    process.exit(0);
  });
