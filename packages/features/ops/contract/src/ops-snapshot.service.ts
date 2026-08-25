import type { DashboardData } from "./ops-dashboard";
import type { DetailSnapshot, LiveSnapshot } from "./ops-snapshot";

export interface OpsSnapshotLease {
  isHeld: boolean;
  epoch: number;
  token: string | null;
}

export interface OpsBadgeCounts {
  blockedCount: number;
  dlqCount: number;
  computedAt: Date;
}

export interface OpsSnapshotAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options: { once: true }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** Shared snapshot capability used by the Ops collector and transports. */
export abstract class OpsSnapshotService {
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract tryGetDashboardData(): DashboardData | null;
  abstract getBadgeCounts(): OpsBadgeCounts;
  abstract streamDashboard(input: {
    signal?: OpsSnapshotAbortSignal;
  }): AsyncIterable<DashboardData>;
  abstract acquireOrRenewLease(input: { writerId: string }): Promise<OpsSnapshotLease>;
  abstract releaseLease(): Promise<void>;
  abstract writeLive(input: {
    snapshot: LiveSnapshot;
    leaseToken: string;
  }): Promise<boolean>;
  abstract writeDetail(input: {
    snapshot: DetailSnapshot;
    leaseToken: string;
  }): Promise<boolean>;
}
