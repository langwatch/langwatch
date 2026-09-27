import type { RumCollectorAnswer, RumCollectorChannel } from "../rum-collector.channel.ts";

/** Records every forwarded export and answers with the configured outcome. */
export class MemoryRumCollectorChannel implements RumCollectorChannel {
  readonly #sent: string[] = [];
  readonly #answer: () => Promise<RumCollectorAnswer>;

  private constructor(answer: () => Promise<RumCollectorAnswer>) {
    this.#answer = answer;
  }

  static create({
    answer = () => Promise.resolve({ accepted: true, status: 200 }),
  }: Readonly<{ answer?: () => Promise<RumCollectorAnswer> }> = {}): MemoryRumCollectorChannel {
    return new MemoryRumCollectorChannel(answer);
  }

  send(traceExport: string): Promise<RumCollectorAnswer> {
    this.#sent.push(traceExport);
    return this.#answer();
  }

  sent(): readonly string[] {
    return this.#sent;
  }
}
