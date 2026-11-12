/**
 * Tests run in-process by default (`LANGWATCH_NO_DAEMON=1`) -- a daemon
 * here could serve stale spawns or leak a previous build's module graph.
 * Daemon tests opt back in with `LANGWATCH_NO_DAEMON=0` per invocation.
 */
process.env.LANGWATCH_NO_DAEMON ??= "1";

/**
 * A session's own tool config (a Claude Code or Codex session running the suite) never
 * leaks in.
 */
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
