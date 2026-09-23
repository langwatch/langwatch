/**
 * The LangWatch-hosted provider slot a connected install's gateway adds for one
 * organization (ADR-156 §8). Licensing writes and clears it; the gateway reads it.
 */
export type StoredGatewayConnectUpstream = Readonly<{
  organizationId: string;
  baseUrl: string;
  encryptedToken: string;
  instanceId: string;
}>;

export abstract class GatewayConnectUpstreamRepository {
  /** The organization's slot, or an empty list where it has none. */
  abstract findForOrganization(organizationId: string): Promise<StoredGatewayConnectUpstream[]>;
  /** Replaces the organization's slot whole. */
  abstract save(slot: StoredGatewayConnectUpstream): Promise<void>;
  /** Drops the organization's slot. Safe to repeat. */
  abstract clear(organizationId: string): Promise<void>;
}
