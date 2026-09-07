// Loaded into the Playwright MCP process by dev/scripts/playwright-mcp.sh
// (node --require). See specs/setup/mcp-browser-lifecycle.feature.
//
// When the session that spawned an MCP dies hard, nothing signals the MCP: it
// reparents to launchd and keeps running, and the Chrome it launched outlives
// even that, because a browser detaches from its parent's fate on purpose.
// Observed: 20 orphaned Chromes and 7.4 GB of their profiles, each from a
// dogfooding session that was long gone.
//
// macOS has no die-with-parent, so the process watches for itself: poll the
// parent pid, and on orphaning ask everything to shut down the way a clean
// disconnect would - SIGTERM to the direct children (the browser), SIGTERM to
// self (which runs the MCP's own shutdown handlers), and a hard exit only if
// those hang.

const { execFileSync } = require("node:child_process");

const DEFAULT_EVERY_MS = 10_000;

const everyMs = (() => {
  const raw = Number.parseInt(process.env.LANGWATCH_MCP_ORPHAN_WATCH_MS ?? "", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_EVERY_MS;
})();

function children(pid) {
  try {
    const out = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => Number.parseInt(line, 10))
      .filter(Number.isInteger);
  } catch {
    return []; // no children, or no pgrep: nothing extra to stop
  }
}

const timer = setInterval(() => {
  if (process.ppid > 1) return;
  clearInterval(timer);
  for (const pid of children(process.pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  process.kill(process.pid, "SIGTERM");
  // Insurance, not the mechanism: if a shutdown handler hangs, do not stand
  // in for the zombie this exists to prevent.
  setTimeout(() => process.exit(0), 15_000).unref();
}, everyMs);
// The watch must never be what keeps the process alive.
timer.unref();
