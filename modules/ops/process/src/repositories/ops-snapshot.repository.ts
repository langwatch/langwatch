import type { DetailSnapshot, LiveSnapshot, OpsSnapshotLease } from "@langwatch/ops-contract";

/** A published snapshot, or none yet (never written, expired, or unreadable). */
export type OpsSnapshotRead<Snapshot> = { kind: "hit"; snapshot: Snapshot } | { kind: "miss" };

export abstract class OpsSnapshotRepository {
  abstract acquireOrRenewLease(input: { writerId: string }): Promise<OpsSnapshotLease>;
  abstract releaseLease(): Promise<void>;
  abstract writeLive(input: { snapshot: LiveSnapshot; leaseToken: string }): Promise<boolean>;
  abstract writeDetail(input: { snapshot: DetailSnapshot; leaseToken: string }): Promise<boolean>;
  abstract readLive(): Promise<OpsSnapshotRead<LiveSnapshot>>;
  abstract readDetail(): Promise<OpsSnapshotRead<DetailSnapshot>>;
}
