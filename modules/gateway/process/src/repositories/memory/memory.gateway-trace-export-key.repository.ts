import {
  GatewayTraceExportKeyRepository,
  type StoredGatewayTraceExportKey,
} from "../gateway-trace-export-key.repository.ts";

export class MemoryGatewayTraceExportKeyRepository extends GatewayTraceExportKeyRepository {
  readonly #keys = new Map<string, StoredGatewayTraceExportKey>();

  private constructor() {
    super();
  }

  static create(): MemoryGatewayTraceExportKeyRepository {
    return new MemoryGatewayTraceExportKeyRepository();
  }

  async findForProject(projectId: string): Promise<StoredGatewayTraceExportKey[]> {
    const key = this.#keys.get(projectId);
    return key ? [key] : [];
  }

  async saveFirst(key: StoredGatewayTraceExportKey): Promise<StoredGatewayTraceExportKey> {
    const kept = this.#keys.get(key.projectId) ?? key;
    this.#keys.set(key.projectId, kept);
    return kept;
  }
}
