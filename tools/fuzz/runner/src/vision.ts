import { createHash } from "node:crypto";

import { z } from "zod";

import { normaliseMessage, type Draft } from "./oracles.ts";
import { routeLabel } from "./report.ts";

export const VISION_MODEL = "claude-haiku-5-5";
/** PRICE is dollars per token for prompts under 100K (.claude/handoffs/haiku-cv-bughunt.md). */
const PRICE = { input: 0.1e-6, output: 0.5e-6 };
const ARIA_CHARS = 4000;
const JUDGE_MILLIS = 90_000;

export const VISION_KINDS = [
  "error-shown",
  "blank-panel",
  "stuck-loading",
  "broken-layout",
  "overlap",
  "wrong-content",
  "other",
] as const;

const verdictSchema = z.strictObject({
  findings: z.array(
    z.strictObject({
      kind: z.enum(VISION_KINDS),
      element: z.string(),
      message: z.string(),
    }),
  ),
});
export type VisionVerdict = z.infer<typeof verdictSchema>["findings"][number];

/** JUDGE_SCHEMA is the verdict as JSON schema, for the API's structured output. */
const { $schema: _draft, ...JUDGE_SCHEMA } = z.toJSONSchema(verdictSchema, { io: "output" });

const SYSTEM = `You are a QA tester judging one screenshot of LangWatch, an LLM-ops web app, on a local dev stack with seed data.
Report only defects a user would notice: an error message or toast, an empty panel that should hold content, a spinner or skeleton that never resolved, overlapping or clipped elements, broken layout, raw template text or "undefined"/"NaN".
Empty states with a clear call to action are not defects. A dev-stack badge is not a defect. When nothing is wrong, answer an empty findings list.
element: the affected element as role and accessible name from the accessibility tree, e.g. button "Save". message: one short line, no ids or numbers.`;

export interface JudgeInput {
  image: Buffer;
  route: string;
  aria: string;
}

export interface Judgement {
  findings: VisionVerdict[];
  inputTokens: number;
  outputTokens: number;
}

/** Judge looks at one page; the real one is Haiku, tests pass a fake. */
export type Judge = (input: JudgeInput) => Promise<Judgement>;

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/** haikuJudge asks Haiku at low effort for a verdict; interactionsimulator's sonnet.ts fetch. */
export const haikuJudge =
  ({ apiKey, baseUrl }: { apiKey: string; baseUrl?: string }): Judge =>
  async ({ image, route, aria }) => {
    const response = await fetch(`${baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 4000,
        output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: image.toString("base64") },
              },
              {
                type: "text",
                text: `Route: ${route}\nAccessibility tree (trimmed):\n${aria.slice(0, ARIA_CHARS)}`,
              },
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
    const parsed = responseSchema.parse(await response.json());
    const usage = {
      inputTokens: parsed.usage.input_tokens,
      outputTokens: parsed.usage.output_tokens,
    };
    if (parsed.stop_reason === "refusal") return { findings: [], ...usage };
    const text = parsed.content.flatMap((block) =>
      block.type === "text" ? [block.text ?? ""] : [],
    );
    return { findings: verdictSchema.parse(JSON.parse(text.join(""))).findings, ...usage };
  };

const normaliseElement = (element: string): string =>
  normaliseMessage(element.toLowerCase().replaceAll(/["'`]/g, "").replaceAll(/\s+/g, " ").trim());

/** visionDraft signs a verdict by route, kind and element, never its free-text message. */
export const visionDraft = ({
  route,
  verdict,
}: {
  route: string;
  verdict: VisionVerdict;
}): Draft => ({
  kind: "vision",
  message: `${verdict.kind} at ${verdict.element}: ${verdict.message}`.slice(0, 500),
  signature: `vision ${routeLabel(route)} ${verdict.kind} ${normaliseElement(verdict.element)}`,
});

export interface PageCost {
  route: string;
  hash: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  findings: number;
}

/** VisionLedger is what vision.json says: per page cost, totals, and the judge's failures. */
export interface VisionLedger {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  perPageUsd: number;
  failures: number;
  firstFailure: string;
  pages: PageCost[];
}

/**
 * VisionCheck judges a route's settled screenshot once per distinct picture, judges a flagged
 * page once more and keeps only the findings both judgements name.
 */
export class VisionCheck {
  private readonly judged = new Map<string, string>();
  private readonly pages: PageCost[] = [];
  private failures = 0;
  private firstFailure = "";

  constructor(private readonly judge: Judge) {}

  async check({ route, image, aria }: JudgeInput): Promise<Draft[]> {
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
    if (this.judged.get(route) === hash) return [];
    this.judged.set(route, hash);
    const cost: PageCost = {
      route,
      hash,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      findings: 0,
    };
    this.pages.push(cost);
    const ask = async (): Promise<Draft[]> => {
      const judgement = await this.judge({ route, image, aria });
      cost.calls += 1;
      cost.inputTokens += judgement.inputTokens;
      cost.outputTokens += judgement.outputTokens;
      cost.usd += judgement.inputTokens * PRICE.input + judgement.outputTokens * PRICE.output;
      return judgement.findings.map((verdict) => visionDraft({ route, verdict }));
    };
    try {
      const first = await ask();
      if (first.length === 0) return [];
      const second = new Set((await ask()).map((draft) => draft.signature));
      const agreed = first.filter((draft) => second.has(draft.signature));
      cost.findings = agreed.length;
      return agreed;
    } catch (thrown) {
      this.failures += 1;
      this.firstFailure ||= String(thrown instanceof Error ? thrown.message : thrown).slice(0, 300);
      return [];
    }
  }

  ledger(): VisionLedger {
    const sum = (pick: (page: PageCost) => number): number =>
      this.pages.reduce((total, page) => total + pick(page), 0);
    const usd = sum((page) => page.usd);
    return {
      model: VISION_MODEL,
      calls: sum((page) => page.calls),
      inputTokens: sum((page) => page.inputTokens),
      outputTokens: sum((page) => page.outputTokens),
      usd,
      perPageUsd: this.pages.length === 0 ? 0 : usd / this.pages.length,
      failures: this.failures,
      firstFailure: this.firstFailure,
      pages: this.pages,
    };
  }
}
