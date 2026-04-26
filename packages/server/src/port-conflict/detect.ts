import { execa } from "execa";
import { allocatePorts, MAX_PORT_SLOT_ATTEMPTS, PORT_SLOT_INCREMENT, portsToCheck, type PortAllocation } from "../shared/ports.ts";

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

async function pidHoldingPort(port: number): Promise<number | null> {
  try {
    const { stdout } = await execa("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { reject: false });
    const first = stdout.split("\n").map((s) => s.trim()).filter(Boolean)[0];
    if (!first) return null;
    const pid = Number.parseInt(first, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function commandForPid(pid: number): Promise<string> {
  try {
    const { stdout } = await execa("ps", ["-o", "command=", "-p", String(pid)], { reject: false });
    return stdout.trim().slice(0, 100) || `pid ${pid}`;
  } catch {
    return `pid ${pid}`;
  }
}

export async function detectConflicts(base: number): Promise<ConflictReport> {
  const alloc = allocatePorts(base);
  const checks = portsToCheck(alloc);
  const conflicts: PortConflict[] = [];
  for (const { port, label } of checks) {
    const pid = await pidHoldingPort(port);
    if (pid != null) {
      conflicts.push({ port, label, pid, command: await commandForPid(pid) });
    }
  }
  let suggestedBase: number | null = null;
  if (conflicts.length > 0) {
    suggestedBase = await findFreeBase(base);
  }
  return { base, alloc, conflicts, suggestedBase };
}

async function findFreeBase(start: number): Promise<number | null> {
  let candidate = start;
  for (let i = 0; i < MAX_PORT_SLOT_ATTEMPTS; i++) {
    candidate += PORT_SLOT_INCREMENT;
    const allocCandidate = allocatePorts(candidate);
    const taken = await Promise.all(
      portsToCheck(allocCandidate).map(async ({ port }) => (await pidHoldingPort(port)) != null)
    );
    if (!taken.some(Boolean)) return candidate;
  }
  return null;
}

export async function killPidGroups(pids: number[]): Promise<void> {
  const groups = new Set<number>();
  for (const pid of pids) {
    try {
      const { stdout } = await execa("ps", ["-o", "pgid=", "-p", String(pid)], { reject: false });
      const pgid = Number.parseInt(stdout.trim(), 10);
      if (Number.isFinite(pgid)) groups.add(pgid);
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
