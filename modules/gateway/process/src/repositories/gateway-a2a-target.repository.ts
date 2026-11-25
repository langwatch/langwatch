import type {
  CreateGatewayA2aTargetInput,
  GatewayA2aTargetResource,
  UpdateGatewayA2aTargetInput,
} from "@langwatch/gateway-contract";

import type { GatewayPersistenceTransaction } from "./gateway-transaction.repository.ts";

/** The stored upstream an edit was checked against: its URL and whether headers are saved. */
export type GatewayA2aTargetUpstream = { upstreamUrl: string; hasUpstreamHeaders: boolean };

/** An edit; with `expectedUpstream` it lands only while the stored row still matches it. */
export type GatewayA2aTargetUpdate = UpdateGatewayA2aTargetInput & {
  expectedUpstream?: GatewayA2aTargetUpstream;
};

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
  /** Live targets scoped to one project, without the org-wide ones. */
  abstract findByProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<GatewayA2aTargetResource[]>;
  abstract findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayA2aTargetResource | null>;
  abstract create(
    input: CreateGatewayA2aTargetInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource>;
  /** Refuses with `gateway_a2a_target_headers_need_replacing` once `expectedUpstream` fails. */
  abstract update(
    input: GatewayA2aTargetUpdate,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource>;
  abstract archive(
    input: { id: string; organizationId: string },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource>;
}
