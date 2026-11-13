import fs from "node:fs";
import { afterAll } from "vitest";

import { isolateHome } from "./__tests__/helpers/isolate-home";

/**
 * Tests run in-process by default (`LANGWATCH_NO_DAEMON=1`) -- a daemon
 * here could serve stale spawns or leak a previous build's module graph.
 * Daemon tests opt back in with `LANGWATCH_NO_DAEMON=0` per invocation.
 */
process.env.LANGWATCH_NO_DAEMON ??= "1";

/**
 * Every test file starts in a temp HOME with no config location variables
 * set, so a test that writes agent settings never touches the developer's
 * own files, even when run from inside a Claude Code session.
 */
const testHome = isolateHome(process.env);
afterAll(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});
