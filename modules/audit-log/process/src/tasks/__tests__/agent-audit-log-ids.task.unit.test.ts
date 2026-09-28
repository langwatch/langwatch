import { describe, expect, it } from "vitest";

import type { AgentAuditLogRepairReport } from "../../services/agent-audit-log-ids.service.ts";
import { AgentAuditLogIdsTask, type AgentAuditLogRepair } from "../agent-audit-log-ids.task.ts";

/** Records whether each run was told to execute. */
class RecordedRepair implements AgentAuditLogRepair {
  readonly executes: boolean[] = [];

  async repair({ execute }: { execute: boolean }): Promise<AgentAuditLogRepairReport> {
    this.executes.push(execute);
    return { mode: execute ? "execute" : "dry-run", actions: [] };
  }
}

describe("given the agent audit-log id backfill task", () => {
  /** @scenario "The legacy audit repair is explicitly invoked" */
  it("writes by default, as main's script did, and only reports under --dry-run", async () => {
    const repair = new RecordedRepair();
    const task = AgentAuditLogIdsTask.create({ repair: () => repair });
    const signal = new AbortController().signal;

    await task.run({ args: [], signal });
    await task.run({ args: ["--dry-run"], signal });

    expect(repair.executes).toEqual([true, false]);
  });
});
