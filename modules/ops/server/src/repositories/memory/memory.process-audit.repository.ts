import { generate } from "@langwatch/ksuid";
import type { ProcessAuditEntryView } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";
import { ProcessAuditSink, type ProcessControlAction } from "../process/ops-audit.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

const PROCESS_AUDIT_KSUID_RESOURCE = "procaudit";

/** The process-control trail in memory: an act appended here is an act listed. */
export class MemoryProcessAuditRepository extends ProcessAuditSink {
  static create({ store }: { store: MemoryOpsStore }): MemoryProcessAuditRepository {
    return new MemoryProcessAuditRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async append(entry: {
    actorUserId: string;
    action: ProcessControlAction;
    processName: string | null;
    projectId: string | null;
    processKey: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.store.processAudit.push({
      id: generate(PROCESS_AUDIT_KSUID_RESOURCE).toString(),
      createdAt: nowInstant().epochMilliseconds,
      action: entry.action,
      targetId: entry.processKey ?? entry.processName ?? "__fleet__",
      actorUserId: entry.actorUserId,
      metadata: entry.metadata ?? {},
    });
  }

  async listRecent({ limit }: { limit: number }): Promise<ProcessAuditEntryView[]> {
    return [...this.store.processAudit]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  }
}
