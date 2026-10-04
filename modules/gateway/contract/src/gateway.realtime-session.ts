import type { Instant } from "@langwatch/time";

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
  mintedAt: Instant;
  vendorConversationId: string | null;
  /** Absent on a record built before metering was carried, which reads as null. */
  kind?: string | null;
  metering?: string | null;
  credentialExpiresAt?: Instant | null;
  transcriptionModel?: string | null;
  lastReportAt?: Instant | null;
  reportCount?: number;
}
