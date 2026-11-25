import { generate } from "@langwatch/ksuid";
import type { DetailSnapshot, LiveSnapshot, OpsSnapshotLease } from "@langwatch/ops-contract";

import { type OpsSnapshotRead, OpsSnapshotRepository } from "../ops-snapshot.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/**
 * The published snapshots and their writer lease in memory, fenced as the stored
 * artifact is: a write needs the current lease token and never moves `computedAt` back.
 */
export class MemoryOpsSnapshotRepository extends OpsSnapshotRepository {
  /** The token this instance last placed in the lease, if any. */
  private currentToken: string | undefined;

  static create({ store }: { store: MemoryOpsStore }): MemoryOpsSnapshotRepository {
    return new MemoryOpsSnapshotRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async acquireOrRenewLease({ writerId }: { writerId: string }): Promise<OpsSnapshotLease> {
    const { snapshots } = this.store;
    if (this.currentToken && snapshots.leaseToken === this.currentToken) {
      return { isHeld: true, epoch: snapshots.epoch, token: this.currentToken };
    }
    this.currentToken = undefined;
    if (snapshots.leaseToken) return { isHeld: false, epoch: snapshots.epoch, token: null };

    const token = `${writerId}:${generate("opssnapshotlock").toString()}`;
    snapshots.leaseToken = token;
    snapshots.epoch += 1;
    this.currentToken = token;
    return { isHeld: true, epoch: snapshots.epoch, token };
  }

  async releaseLease(): Promise<void> {
    if (this.currentToken && this.store.snapshots.leaseToken === this.currentToken) {
      this.store.snapshots.leaseToken = undefined;
    }
    this.currentToken = undefined;
  }

  async writeLive({
    snapshot,
    leaseToken,
  }: {
    snapshot: LiveSnapshot;
    leaseToken: string;
  }): Promise<boolean> {
    if (!this.mayWrite({ leaseToken, previous: this.store.snapshots.live, snapshot })) return false;
    this.store.snapshots.live = snapshot;
    return true;
  }

  async writeDetail({
    snapshot,
    leaseToken,
  }: {
    snapshot: DetailSnapshot;
    leaseToken: string;
  }): Promise<boolean> {
    if (!this.mayWrite({ leaseToken, previous: this.store.snapshots.detail, snapshot })) {
      return false;
    }
    this.store.snapshots.detail = snapshot;
    return true;
  }

  async readLive(): Promise<OpsSnapshotRead<LiveSnapshot>> {
    const { live } = this.store.snapshots;
    return live ? { kind: "hit", snapshot: live } : { kind: "miss" };
  }

  async readDetail(): Promise<OpsSnapshotRead<DetailSnapshot>> {
    const { detail } = this.store.snapshots;
    return detail ? { kind: "hit", snapshot: detail } : { kind: "miss" };
  }

  private mayWrite({
    leaseToken,
    previous,
    snapshot,
  }: {
    leaseToken: string;
    previous: LiveSnapshot | DetailSnapshot | undefined;
    snapshot: LiveSnapshot | DetailSnapshot;
  }): boolean {
    if (this.store.snapshots.leaseToken !== leaseToken) return false;
    return !previous || previous.computedAt <= snapshot.computedAt;
  }
}
