import type {
  CreateShareInput,
  ResolveShareInput,
  RevokeShareInput,
  ShareLink,
  ShareResourceInput,
  SharedPayloadCacheInput,
  ShareWithProject,
  TracePinInput,
} from "./share";

export abstract class ShareService {
  abstract listForResource(input: ShareResourceInput): Promise<ShareLink[]>;
  abstract resolveForViewer(input: ResolveShareInput): Promise<ShareWithProject>;
  abstract createShare(input: CreateShareInput): Promise<ShareLink>;
  abstract revokeById(input: RevokeShareInput): Promise<void>;
  abstract unshare(input: ShareResourceInput): Promise<void>;
  abstract revokeAllTraceShares(projectId: string): Promise<void>;
  abstract unpinTrace(input: TracePinInput): Promise<void>;
  abstract tryGetCachedPayload(input: SharedPayloadCacheInput): Promise<unknown | null>;
  abstract cachePayload(input: SharedPayloadCacheInput & { payload: unknown }): Promise<void>;
}
