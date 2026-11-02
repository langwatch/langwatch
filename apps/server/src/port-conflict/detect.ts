import { execa } from "execa";

import {
  allocatePorts,
  MAX_PORT_SLOT_ATTEMPTS,
  PORT_SLOT_INCREMENT,
  portsToCheck,
  type PortAllocation,
} from "../shared/ports.ts";

export type PortConflict = {
  port: number;
  label: string;
  pid: number;
  command: string;
};

export type ConflictReport = {
  base: number;
  alloc: PortAllocation;
  conflicts: PortConflict[];
  suggestedBase: number | null;
};

/**
 * Every TCP port something listens on, with the pid holding it, from one `lsof` run. One run
 * per port, each resolving host and port names, cost seconds before anything else could start.
 */
async function listeningPids(): Promise<Map<number, number>> {
  try {
    const { stdout } = await execa("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], {
      reject: false,
    });
    return parseListeners(stdout);
  } catch {
    // No lsof: nothing is reported held, as before.
    return new Map();
  }
}

/** `lsof -F pn` output: a `p<pid>` line, then one `n<host>:<port>` line per socket it holds. */
function parseListeners(stdout: string): Map<number, number> {
  const held = new Map<number, number>();
  let pid = Number.NaN;
  for (const line of stdout.split("\n")) {
    const field = line.slice(0, 1);
    const value = line.slice(1);
    if (field === "p") pid = Number.parseInt(value, 10);
    if (field !== "n" || Number.isNaN(pid)) continue;
    const port = Number.parseInt(value.slice(value.lastIndexOf(":") + 1), 10);
    const isFirstHolder = !Number.isNaN(port) && !held.has(port);
    if (isFirstHolder) held.set(port, pid);
  }
  return held;
}

async function commandForPid(pid: number): Promise<string> {
  try {
    const { stdout } = await execa("ps", ["-o", "command=", "-p", String(pid)], {
      reject: false,
    });
    return stdout.trim().slice(0, 100) || `pid ${pid}`;
  } catch {
    return `pid ${pid}`;
  }
}

export async function detectConflicts(base: number): Promise<ConflictReport> {
  const alloc = allocatePorts(base);
  const held = await listeningPids();
  const conflicts = await Promise.all(
    portsToCheck(alloc).flatMap(({ port, label }) => {
      const pid = held.get(port);
      return pid == null
        ? []
        : [commandForPid(pid).then((command) => ({ port, label, pid, command }))];
    }),
  );
  const suggestedBase = conflicts.length > 0 ? findFreeBase({ start: base, held }) : null;
  return { base, alloc, conflicts, suggestedBase };
}

function findFreeBase({
  start,
  held,
}: {
  start: number;
  held: Map<number, number>;
}): number | null {
  let candidate = start;
  for (let i = 0; i < MAX_PORT_SLOT_ATTEMPTS; i++) {
    candidate += PORT_SLOT_INCREMENT;
    const slot = portsToCheck(allocatePorts(candidate));
    const isTaken = slot.some(({ port }) => held.has(port));
    if (!isTaken) return candidate;
  }
  return null;
}

export async function killPidGroups(pids: number[]): Promise<void> {
  const groups = new Set<number>();
  for (const pid of pids) {
    try {
      const { stdout } = await execa("ps", ["-o", "pgid=", "-p", String(pid)], {
        reject: false,
      });
      const pgid = Number.parseInt(stdout.trim(), 10);
      // 0 / 1 are bogus targets: `process.kill(-0, …)` is `process.kill(0, …)`
      // which signals THIS process group (us!), and `kill(-1, …)` signals
      // every process in the system. Either is a foot-gun. Skip them and
      // skip non-finite values (ps may have raced the pid exiting).
      if (Number.isFinite(pgid) && pgid > 1) groups.add(pgid);
    } catch {
      // ignore — pid may have already exited
    }
  }
  for (const pgid of groups) {
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {
      // best effort
    }
  }
}
