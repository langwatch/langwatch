export type TraceSpanSpoolIdentity = {
  spoolRef: string;
  projectId: string;
  traceId: string;
  spanId: string;
};

/** Transient oversized-command storage. The event log remains authoritative. */
export abstract class TraceSpanSpoolPort {
  abstract read(identity: TraceSpanSpoolIdentity): Promise<string>;
  abstract delete(identity: TraceSpanSpoolIdentity): Promise<void>;
}
