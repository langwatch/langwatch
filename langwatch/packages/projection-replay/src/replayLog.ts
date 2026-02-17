import fs from "node:fs";

export type LogEntry =
  | { step: "start"; projection: string; since: string; args: Record<string, unknown> }
  | { step: "discover"; aggregateCount: number; tenantCount: number }
  | { step: "mark"; tenant: string; aggregate: string; status: string }
  | { step: "drain"; tenant: string; aggregate: string; durationMs: number }
  | { step: "cutoff"; tenant: string; aggregate: string; cutoffEventId: string }
  | { step: "replay"; tenant: string; aggregate: string; eventsProcessed: number }
  | { step: "unmark"; tenant: string; aggregate: string }
  | { step: "error"; tenant: string; aggregate: string; error: string }
  | { step: "mark-batch"; tenant: string; count: number }
  | { step: "drain-batch"; tenant: string; count: number; durationMs: number }
  | { step: "cutoff-batch"; tenant: string; count: number; withEvents: number }
  | { step: "replay-batch"; tenant: string; count: number; eventsProcessed: number; durationMs: number }
  | { step: "unmark-batch"; tenant: string; count: number }
  | { step: "complete"; aggregatesReplayed: number; totalEvents: number; durationSec: number };

export class ReplayLog {
  private readonly stream: fs.WriteStream;
  readonly filePath: string;

  constructor(projectionName: string) {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/(\d{8})(\d{6})/, "$1-$2");
    this.filePath = `projection-replay-${projectionName}-${ts}.jsonl`;
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  write(entry: LogEntry): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    this.stream.write(line + "\n");
  }

  close(): void {
    this.stream.end();
  }
}
