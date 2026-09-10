import { TraceSpanIngest } from "../app/trace.infrastructure.ts";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import type { TraceProcessingCommands } from "../app/trace.infrastructure.ts";

export class TraceProcessingSpanIngestAdapter implements TraceSpanIngest {
  readonly #commands: TraceProcessingCommands;
  static create(commands: TraceProcessingCommands): TraceProcessingSpanIngestAdapter {
    return new TraceProcessingSpanIngestAdapter(commands);
  }
  private constructor(commands: TraceProcessingCommands) {
    this.#commands = commands;
  }
  async recordSpan(input: RecordSpanCommandData): Promise<void> {
    await this.#commands.recordSpan(input);
  }
}
