import { create } from "zustand";

export interface ExecutionLogEntry {
  id: string;
  traceId: string;
  timestamp: number;
  status: "pending" | "success" | "error";
  error?: string;
}

interface ExecutionStore {
  batchCount: number;
  staggerMs: number;
  running: boolean;
  log: ExecutionLogEntry[];
  setBatchCount(count: number): void;
  setStaggerMs(ms: number): void;
  setRunning(running: boolean): void;
  addLogEntry(entry: ExecutionLogEntry): void;
  updateLogEntry(id: string, partial: Partial<ExecutionLogEntry>): void;
  clearLog(): void;
}

export const useExecutionStore = create<ExecutionStore>((set) => ({
  batchCount: 1,
  staggerMs: 0,
  running: false,
  log: [],

  setBatchCount(count) {
    set({ batchCount: Math.max(1, Math.min(100, count)) });
  },

  setStaggerMs(ms) {
    set({ staggerMs: Math.max(0, ms) });
  },

  setRunning(running) {
    set({ running });
  },

  addLogEntry(entry) {
    set((state) => ({ log: [entry, ...state.log].slice(0, 50) }));
  },

  updateLogEntry(id, partial) {
    set((state) => ({
      log: state.log.map((e) => (e.id === id ? { ...e, ...partial } : e)),
    }));
  },

  clearLog() {
    set({ log: [] });
  },
}));
