/** Portable session record used by Gateway settlement and reconciliation. */
export interface GatewayRealtimeSessionRecord {
  id: string;
  projectId: string;
  organizationId: string;
  virtualKeyId: string;
  modelProviderId: string;
  vendor: string;
  model: string;
  traceId: string | null;
  requestedModel: string | null;
  mintedAt: Date;
  vendorConversationId: string | null;
}
