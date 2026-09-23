import type { DetailSnapshot, LiveSnapshot, OpsSnapshotLease } from "@langwatch/ops-contract";

export abstract class OpsSnapshotRepository {
  abstract acquireOrRenewLease(input: { writerId: string }): Promise<OpsSnapshotLease>;
  abstract releaseLease(): Promise<void>;
  abstract writeLive(input: { snapshot: LiveSnapshot; leaseToken: string }): Promise<boolean>;
  abstract writeDetail(input: { snapshot: DetailSnapshot; leaseToken: string }): Promise<boolean>;
  abstract tryReadLive(): Promise<LiveSnapshot | null>;
  abstract tryReadDetail(): Promise<DetailSnapshot | null>;
}
