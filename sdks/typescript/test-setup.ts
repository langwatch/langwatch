/**
 * Tests run in-process by default (`LANGWATCH_NO_DAEMON=1`) -- a daemon
 * here could serve stale spawns or leak a previous build's module graph.
 * Daemon tests opt back in with `LANGWATCH_NO_DAEMON=0` per invocation.
 */
process.env.LANGWATCH_NO_DAEMON ??= "1";
