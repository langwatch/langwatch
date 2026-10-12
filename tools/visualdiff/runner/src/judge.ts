import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Plan } from "./protocol.ts";

export const JUDGE_MODEL = "claude-haiku-5-5";
/** PRICE is dollars per token, as tools/fuzz/runner/src/vision.ts prices Haiku. */
const PRICE = { input: 0.1e-6, output: 0.5e-6 };
/** FLAG_RATIO is the Go side's NoiseRatio (classify.go): below it a pair is not flagged. */
export const FLAG_RATIO = 0.02;
const JUDGE_MILLIS = 90_000;

export const REGRESSION_KINDS = [
  "missing-element",
  "broken-layout",
  "error-text",
  "wrong-data",
] as const;
export type RegressionKind = (typeof REGRESSION_KINDS)[number];

export interface Regression {
  kind: RegressionKind;
  element: string;
  message: string;
}

/** JUDGE_SCHEMA is the verdict's JSON schema for structured output; the runner has no zod. */
const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["regressions"],
  properties: {
    regressions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "element", "message"],
        properties: {
          kind: { type: "string", enum: REGRESSION_KINDS },
          element: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You compare two screenshots of one screen of LangWatch, an LLM-ops web app: the first is main, the second is the branch under review.
Report only regressions in the branch a user would notice: an element present on main and missing on the branch, broken or overlapping layout, error text or an error toast, wrong or missing data.
Different seed values, timestamps, ids, colours, spacing or a restyled but working control are harmless: answer an empty regressions list.
element: the affected element as role and visible name, e.g. button "Save". message: one short line, no ids or numbers.`;

export interface PairInput {
  label: string;
  base: Buffer;
  candidate: Buffer;
}

export interface Judgement {
  regressions: Regression[];
  inputTokens: number;
  outputTokens: number;
}

/** Judge compares one pair; the real one is Haiku, tests pass a fake. */
export type Judge = (input: PairInput) => Promise<Judgement>;

const isRegression = (value: unknown): value is Regression => {
  if (typeof value !== "object" || value === null) return false;
  const { kind, element, message }: Record<string, unknown> = Object(value);
  return (
    REGRESSION_KINDS.some((known) => known === kind) &&
    typeof element === "string" &&
    typeof message === "string"
  );
};

const image = (data: Buffer) => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data: data.toString("base64") },
});

/** haikuJudge is tools/fuzz/runner/src/vision.ts's raw fetch, given two images. */
export const haikuJudge =
  ({ apiKey, baseUrl }: { apiKey: string; baseUrl?: string }): Judge =>
  async ({ label, base, candidate }) => {
    const response = await fetch(`${baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 4000,
        output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Screen: ${label}\nMain:` },
              image(base),
              { type: "text", text: "Branch:" },
              image(candidate),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(JUDGE_MILLIS),
    });
    if (!response.ok) {
      throw new Error(
        `Haiku answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    const parsed: {
      content: { type: string; text?: string }[];
      stop_reason: string | null;
      usage: { input_tokens: number; output_tokens: number };
    } = await response.json();
    const usage = {
      inputTokens: parsed.usage.input_tokens,
      outputTokens: parsed.usage.output_tokens,
    };
    if (parsed.stop_reason === "refusal") return { regressions: [], ...usage };
    const text = parsed.content.flatMap((block) =>
      block.type === "text" ? [block.text ?? ""] : [],
    );
    const verdict: { regressions?: unknown } = JSON.parse(text.join(""));
    if (!Array.isArray(verdict.regressions) || !verdict.regressions.every(isRegression)) {
      throw new Error("Haiku answered a verdict outside the schema");
    }
    return { regressions: verdict.regressions, ...usage };
  };

/** signatureOf groups a regression by kind and element, never its free-text message. */
export const signatureOf = (regression: Regression): string =>
  `${regression.kind} ${regression.element.toLowerCase().replaceAll(/["'`]/g, "").replaceAll(/\s+/g, " ").trim()}`;

export interface PairCost {
  label: string;
  hash: string;
  cached: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  regressions: Regression[];
}

/** JudgeLedger is what judge.json says: totals, failures and every flagged pair. */
export interface JudgeLedger {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  cached: number;
  failures: number;
  firstFailure: string;
  pairs: PairCost[];
}

/** pairHash names a pair by both screenshots' bytes, so a cache entry outlives the run. */
export const pairHash = ({ base, candidate }: { base: Buffer; candidate: Buffer }): string =>
  createHash("sha256").update(base).update("\0").update(candidate).digest("hex").slice(0, 32);

/**
 * PairJudge asks the judge about each flagged pair, a second time when the first names a
 * regression, and keeps only what both name; verdicts are cached by pair hash in `cacheFile`.
 */
export class PairJudge {
  private readonly cache: Record<string, Regression[]>;
  private readonly pairs: PairCost[] = [];
  private failures = 0;
  private firstFailure = "";

  constructor(
    private readonly judge: Judge,
    private readonly cacheFile: string,
  ) {
    this.cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  }

  async check({
    label,
    ratio,
    base,
    candidate,
  }: PairInput & { ratio: number }): Promise<Regression[]> {
    if (ratio < FLAG_RATIO) return [];
    const hash = pairHash({ base, candidate });
    const hit = this.cache[hash];
    const cost: PairCost = {
      label,
      hash,
      cached: hit !== undefined,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      regressions: hit ?? [],
    };
    this.pairs.push(cost);
    if (hit !== undefined) return hit;
    const ask = async (): Promise<Regression[]> => {
      const judgement = await this.judge({ label, base, candidate });
      cost.calls += 1;
      cost.inputTokens += judgement.inputTokens;
      cost.outputTokens += judgement.outputTokens;
      cost.usd += judgement.inputTokens * PRICE.input + judgement.outputTokens * PRICE.output;
      return judgement.regressions;
    };
    try {
      const first = await ask();
      const second = new Set(first.length === 0 ? [] : (await ask()).map(signatureOf));
      const agreed = first.filter((regression) => second.has(signatureOf(regression)));
      cost.regressions = agreed;
      this.cache[hash] = agreed;
      return agreed;
    } catch (thrown) {
      this.failures += 1;
      this.firstFailure ||= String(thrown instanceof Error ? thrown.message : thrown).slice(0, 300);
      return [];
    }
  }

  ledger(): JudgeLedger {
    const sum = (pick: (pair: PairCost) => number): number =>
      this.pairs.reduce((total, pair) => total + pick(pair), 0);
    return {
      model: JUDGE_MODEL,
      calls: sum((pair) => pair.calls),
      inputTokens: sum((pair) => pair.inputTokens),
      outputTokens: sum((pair) => pair.outputTokens),
      usd: sum((pair) => pair.usd),
      cached: this.pairs.filter((pair) => pair.cached).length,
      failures: this.failures,
      firstFailure: this.firstFailure,
      pairs: this.pairs,
    };
  }

  /** save writes the cache back and the run's ledger to `ledgerFile`. */
  save(ledgerFile: string): void {
    mkdirSync(dirname(this.cacheFile), { recursive: true });
    writeFileSync(this.cacheFile, JSON.stringify(this.cache));
    mkdirSync(dirname(ledgerFile), { recursive: true });
    writeFileSync(ledgerFile, JSON.stringify(this.ledger(), null, 2));
  }
}

/** JudgeKey is the Anthropic key the entrypoint read; empty when the environment has none. */
export interface JudgeKey {
  apiKey: string;
  baseUrl?: string;
}

/** judgeFor is the plan's judge, or none when the plan does not ask for one. */
export const judgeFor = ({ plan, key }: { plan: Plan; key: JudgeKey }): PairJudge | undefined => {
  if (plan.judge === undefined) return undefined;
  if (key.apiKey === "") throw new Error("the judge needs ANTHROPIC_API_KEY in the environment");
  return new PairJudge(haikuJudge(key), plan.judge.cacheFile);
};
