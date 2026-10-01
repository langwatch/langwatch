/** Sonnet 5.5's list prices, USD per million tokens. */
export const SONNET_USD_PER_MILLION = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

/** jev's list price (modules/instant-eval pricing rules), without the resale markup. */
export const JEV_USD_PER_MILLION_INPUT = 0.042;

/** A Sonnet turn that read the page instead of jev would also have written about this much. */
const SONNET_OUTPUT_PER_STEP = 200;

const usd = ({ tokens, perMillion }: { tokens: number; perMillion: number }): number =>
  (tokens * perMillion) / 1_000_000;

/**
 * Ledger is what a run spent, per model, and what jev saved: every page jev
 * read is a page Sonnet did not, so its tokens are counted at Sonnet's price.
 */
export class Ledger {
  readonly sonnet = { calls: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, usd: 0 };
  readonly jev = { calls: 0, inputTokens: 0, usd: 0 };
  readonly saved = { sonnetCalls: 0, sonnetInputTokens: 0, sonnetOutputTokens: 0, usd: 0 };
  readonly phases: { name: string; millis: number }[] = [];

  sonnetTurn({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  }: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }): void {
    this.sonnet.calls++;
    this.sonnet.inputTokens += inputTokens + cacheWriteTokens;
    this.sonnet.cacheReadTokens += cacheReadTokens;
    this.sonnet.outputTokens += outputTokens;
    const price = SONNET_USD_PER_MILLION;
    this.sonnet.usd +=
      usd({ tokens: inputTokens, perMillion: price.input }) +
      usd({ tokens: cacheWriteTokens, perMillion: price.cacheWrite }) +
      usd({ tokens: cacheReadTokens, perMillion: price.cacheRead }) +
      usd({ tokens: outputTokens, perMillion: price.output });
  }

  jevCall({ inputTokens }: { inputTokens: number }): void {
    this.jev.calls++;
    this.jev.inputTokens += inputTokens;
    this.jev.usd += usd({ tokens: inputTokens, perMillion: JEV_USD_PER_MILLION_INPUT });
    this.saved.sonnetCalls++;
    this.saved.sonnetInputTokens += inputTokens;
    this.saved.sonnetOutputTokens += SONNET_OUTPUT_PER_STEP;
    this.saved.usd +=
      usd({ tokens: inputTokens, perMillion: SONNET_USD_PER_MILLION.input }) +
      usd({ tokens: SONNET_OUTPUT_PER_STEP, perMillion: SONNET_USD_PER_MILLION.output });
  }

  get usd(): number {
    return this.sonnet.usd + this.jev.usd;
  }

  async phase<Value>({ name, work }: { name: string; work: () => Promise<Value> }): Promise<Value> {
    const startedAt = Date.now();
    try {
      return await work();
    } finally {
      this.phases.push({ name, millis: Date.now() - startedAt });
    }
  }

  /** block is the timing and cost block every run ends with. */
  block(): string {
    const money = (value: number): string => `$${value.toFixed(4)}`;
    const seconds = (millis: number): string => `${(millis / 1000).toFixed(1)}s`;
    const total = this.phases.reduce((sum, phase) => sum + phase.millis, 0);
    return [
      "## Timing and cost",
      "",
      "| model | calls | input tokens | cache-read tokens | output tokens | USD |",
      "|---|---|---|---|---|---|",
      `| claude-sonnet-5-5 | ${this.sonnet.calls} | ${this.sonnet.inputTokens} | ${this.sonnet.cacheReadTokens} | ${this.sonnet.outputTokens} | ${money(this.sonnet.usd)} |`,
      `| jev | ${this.jev.calls} | ${this.jev.inputTokens} | 0 | 0 | ${money(this.jev.usd)} |`,
      `| **total** | ${this.sonnet.calls + this.jev.calls} | | | | ${money(this.usd)} |`,
      "",
      `Saved by jev reading the pages: ${this.saved.sonnetCalls} Sonnet calls, ${this.saved.sonnetInputTokens} input and ~${this.saved.sonnetOutputTokens} output Sonnet tokens, ${money(this.saved.usd)}.`,
      "",
      `Wall time ${seconds(total)}: ${this.phases.map((phase) => `${phase.name} ${seconds(phase.millis)}`).join(", ")}.`,
      "",
    ].join("\n");
  }
}
