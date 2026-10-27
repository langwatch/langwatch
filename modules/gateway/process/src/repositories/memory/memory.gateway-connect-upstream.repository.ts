import {
  GatewayConnectUpstreamRepository,
  type StoredGatewayConnectUpstream,
} from "../gateway-connect-upstream.repository.ts";

export class MemoryGatewayConnectUpstreamRepository extends GatewayConnectUpstreamRepository {
  readonly #slots = new Map<string, StoredGatewayConnectUpstream>();

  private constructor() {
    super();
  }

  static create(): MemoryGatewayConnectUpstreamRepository {
    return new MemoryGatewayConnectUpstreamRepository();
  }

  async findForOrganization(organizationId: string): Promise<StoredGatewayConnectUpstream[]> {
    const slot = this.#slots.get(organizationId);
    return slot ? [slot] : [];
  }

  async save(slot: StoredGatewayConnectUpstream): Promise<void> {
    this.#slots.set(slot.organizationId, slot);
  }

  async clear(organizationId: string): Promise<void> {
    this.#slots.delete(organizationId);
  }
}
