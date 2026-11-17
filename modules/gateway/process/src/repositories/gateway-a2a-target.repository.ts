import type {
  CreateGatewayA2aTargetInput,
  GatewayA2aTargetResource,
  UpdateGatewayA2aTargetInput,
} from "@langwatch/gateway-contract";

import type { GatewayPersistenceTransaction } from "./gateway-transaction.repository.ts";

/** A2A targets of an organization; the live tier seals upstream headers at rest. */
export abstract class GatewayA2aTargetRepository {
  /**
   * Live targets of the organization, org-wide and project-scoped alike.
   * `headers: false` skips unsealing; `upstreamHeaders` then comes back empty.
   */
  abstract findAll(
    organizationId: string,
    options?: { headers?: boolean },
  ): Promise<GatewayA2aTargetResource[]>;
  abstract findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayA2aTargetResource | null>;
  abstract create(
    input: CreateGatewayA2aTargetInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource>;
  abstract update(
    input: UpdateGatewayA2aTargetInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource>;
  abstract archive(
    input: { id: string; organizationId: string },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource>;
}
