import type {
  AppendGatewayAuditInput,
  GatewayAuditRepository,
} from "../gateway-audit.repository.ts";

/** The gateway's audit trail in memory, readable back in the order it was written. */
export class MemoryGatewayAuditRepository implements GatewayAuditRepository {
  static create(): MemoryGatewayAuditRepository {
    return new MemoryGatewayAuditRepository();
  }

  readonly #entries: AppendGatewayAuditInput[] = [];

  private constructor() {}

  async append(input: AppendGatewayAuditInput): Promise<void> {
    this.#entries.push({ ...input, projectId: input.projectId ?? null });
  }

  /** Every entry written, oldest first. */
  entries(): readonly AppendGatewayAuditInput[] {
    return [...this.#entries];
  }
}
