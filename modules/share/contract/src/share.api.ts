import type { PinnedTrace, PinTraceInput } from "@langwatch/data-retention-contract";
import { featureApi } from "@langwatch/runtime-composition";
import type {
  CreateShareInput,
  ResolveShareInput,
  RevokeShareInput,
  ShareLink,
  ShareProjectScope,
  ShareResourceInput,
  SharedPayloadCacheInput,
  ShareWithProject,
  TracePinInput,
} from "./share.ts";

/**
 * Every share-link operation, plus the retention pin an active link holds. A
 * pin is retention state, but a trace unpinned under a live link cannot be
 * redeemed, so share is the door that guards it.
 */
export interface ShareApi {
  listForResource(input: ShareResourceInput): Promise<ShareLink[]>;
  resolveForViewer(input: ResolveShareInput): Promise<ShareWithProject>;
  createShare(input: CreateShareInput): Promise<ShareLink>;
  revokeById(input: RevokeShareInput): Promise<void>;
  unshare(input: ShareResourceInput): Promise<void>;
  revokeAllTraceShares(projectId: string): Promise<void>;
  pinTrace(input: PinTraceInput): Promise<PinnedTrace>;
  unpinTrace(input: TracePinInput): Promise<void>;
  findTracePin(input: TracePinInput): Promise<PinnedTrace | null>;
  listTracePins(input: ShareProjectScope): Promise<PinnedTrace[]>;
  findCachedPayload(input: SharedPayloadCacheInput): Promise<unknown | null>;
  cachePayload(input: SharedPayloadCacheInput & { payload: unknown }): Promise<void>;
}

export const ShareApi = featureApi<ShareApi>("share");
