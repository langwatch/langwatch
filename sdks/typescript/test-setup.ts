/**
 * Tests run in-process by default (`LANGWATCH_NO_DAEMON=1`) -- a daemon
 * here could serve stale spawns or leak a previous build's module graph.
 * Daemon tests opt back in with `LANGWATCH_NO_DAEMON=0` per invocation.
 */
process.env.LANGWATCH_NO_DAEMON ??= "1";

/**
 * These point the CLI at the developer's real tool config. A test that
 * wants one sets it itself to a temp dir.
 */
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
delete process.env.LANGWATCH_CLI_CONFIG;
