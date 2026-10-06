import type {
  AppendGatewayAuditInput,
  GatewayAuditRepository,
} from "../gateway-audit.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** The gateway's audit trail in memory: appended to the store's `auditEntries`. */
export class MemoryGatewayAuditRepository implements GatewayAuditRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayAuditRepository {
    return new MemoryGatewayAuditRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {}

  async append(input: AppendGatewayAuditInput): Promise<void> {
    this.store.auditEntries.push({ ...input, projectId: input.projectId ?? null });
  }
}
