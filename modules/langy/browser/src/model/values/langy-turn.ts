export interface LangyTurnMetric {
  value: number;
  label: string;
  suffix?: string;
  format?: (value: number) => string;
}

export interface LangyProgressSample {
  current: number;
  total: number;
  receivedAtMs: number;
  batchItems?: number;
  batchDurationMs?: number;
}
