/** What the collector said to one forwarded export. */
export type RumCollectorAnswer = Readonly<{ accepted: boolean; status: number }>;

/** The platform's own OTLP collector, which the ingest door forwards browser traces to. */
export interface RumCollectorChannel {
  /** Throws when the collector cannot be reached at all. */
  send(traceExport: string): Promise<RumCollectorAnswer>;
}
