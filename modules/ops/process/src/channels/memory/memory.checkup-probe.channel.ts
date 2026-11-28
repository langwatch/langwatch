import type { CheckupProbeAnswer, CheckupProbeChannel } from "../checkup-probe.channel.ts";

/**
 * The checkup's probes in memory: every URL asked is kept, with the headers a
 * GET carried, and each answers 200 with an empty body unless a test scripted
 * another answer for it.
 */
export class MemoryCheckupProbeChannel implements CheckupProbeChannel {
  readonly asked: string[] = [];
  readonly gets: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  readonly answers = new Map<string, CheckupProbeAnswer>();

  private constructor() {}

  static create(): MemoryCheckupProbeChannel {
    return new MemoryCheckupProbeChannel();
  }

  async reach(url: string): Promise<void> {
    this.asked.push(url);
  }

  async get({
    url,
    headers = {},
  }: {
    url: string;
    headers?: Readonly<Record<string, string>>;
  }): Promise<CheckupProbeAnswer> {
    this.asked.push(url);
    this.gets.push({ url, headers });
    return this.answers.get(url) ?? { status: 200, body: {} };
  }
}
