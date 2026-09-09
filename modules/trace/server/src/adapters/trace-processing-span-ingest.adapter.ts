import { TraceSpanIngestPort } from "../ports/trace-span-ingest.port.ts";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import type { TraceProcessingCommands } from "../ports/trace-processing-installer.port.ts";

export class TraceProcessingSpanIngestAdapter extends TraceSpanIngestPort {
  readonly #commands: TraceProcessingCommands;
  static create(commands: TraceProcessingCommands): TraceProcessingSpanIngestAdapter {
    return new TraceProcessingSpanIngestAdapter(commands);
  }
  private constructor(commands: TraceProcessingCommands) {
    super();
    this.#commands = commands;
  }
  async recordSpan(input: RecordSpanCommandData): Promise<void> {
    await this.#commands.recordSpan(input);
  }
}
