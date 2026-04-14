export interface ReplayStatus {
  state: "idle" | "running" | "completed" | "failed" | "cancelled";
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  projectionNames: string[];
  since: string;
  tenantIds: string[];
  currentProjection: string | null;
  currentPhase: string | null;
  aggregatesProcessed: number;
  aggregatesTotal: number;
  eventsProcessed: number;
  error: string | null;
  description: string | null;
  userName: string | null;
}

export interface ReplayHistoryEntry {
  runId: string;
  projectionNames: string[];
  since: string;
  tenantIds: string[];
  description: string;
  startedAt: string;
  completedAt: string | null;
  state: "completed" | "failed" | "cancelled";
  userName: string;
  aggregatesProcessed: number;
  eventsProcessed: number;
}

export const IDLE_STATUS: ReplayStatus = {
  state: "idle",
  runId: null,
  startedAt: null,
  completedAt: null,
  projectionNames: [],
  since: "",
  tenantIds: [],
  currentProjection: null,
  currentPhase: null,
  aggregatesProcessed: 0,
  aggregatesTotal: 0,
  eventsProcessed: 0,
  error: null,
  description: null,
  userName: null,
};

export interface ReplayRepository {
  getStatus(): Promise<ReplayStatus>;
  writeStatus(params: { status: ReplayStatus }): Promise<void>;

  acquireLock(params: {
    runId: string;
    ttlSeconds: number;
  }): Promise<boolean>;
  releaseLock(params: { runId: string }): Promise<void>;
  getLockHolder(): Promise<string | null>;

  isCancelled(): Promise<boolean>;
  setCancelled(params: { ttlSeconds: number }): Promise<void>;
  clearCancelFlag(): Promise<void>;

  pushToHistory(params: { entry: ReplayHistoryEntry }): Promise<void>;
  getHistory(): Promise<ReplayHistoryEntry[]>;
}

export class NullReplayRepository implements ReplayRepository {
  async getStatus(): Promise<ReplayStatus> {
    return { ...IDLE_STATUS };
  }

  async writeStatus(): Promise<void> {}

  async acquireLock(): Promise<boolean> {
    return false;
  }

  async releaseLock(): Promise<void> {}

  async getLockHolder(): Promise<string | null> {
    return null;
  }

  async isCancelled(): Promise<boolean> {
    return false;
  }

  async setCancelled(): Promise<void> {}

  async clearCancelFlag(): Promise<void> {}

  async pushToHistory(): Promise<void> {}

  async getHistory(): Promise<ReplayHistoryEntry[]> {
    return [];
  }
}
