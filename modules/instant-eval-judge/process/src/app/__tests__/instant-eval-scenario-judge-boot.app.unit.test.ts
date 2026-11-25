/**
 * The judge refuses to boot on a scenario turn decision backend it cannot bill or call, and
 * answers a scenario judge call through the composed module.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 * @vitest-environment node
 */
import type { InstantEvalJudgeRoutePricing } from "@langwatch/instant-eval-judge-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import {
  scenarioJudgeCall,
  SYNTHETIC_SCENARIO_PRICING,
  syntheticScenarioRouteTable,
} from "../../__tests__/support/instant-eval-scenario-judge.test-fakes.ts";
import { HttpInstantEvalJudgeChannels } from "../../channels/http/http.instant-eval-judge.channels.ts";
import { MemoryInstantEvalProviderSpendChannel } from "../../channels/memory/memory.instant-eval-provider-spend.channel.ts";
import { MemoryInstantEvalJudgeRepositories } from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeModule } from "../instant-eval-judge.app.ts";

const ALL_KEYS = {
  JEV_API_KEY: "jev-key",
  INSTANT_EVAL_DECISIONS_API_KEY: "decisions-key",
  INSTANT_EVAL_ANTHROPIC_API_KEY: "anthropic-key",
  INSTANT_EVAL_OPENAI_API_KEY: "openai-key",
  INSTANT_EVAL_GEMINI_API_KEY: "gemini-key",
};

/** The same table with a Gemini backend answering the turn decision. */
const GEMINI_TABLE = syntheticScenarioRouteTable({
  backends: {
    "llm-a": { kind: "anthropic_messages", model: "llm-model-a" },
    "llm-c": { kind: "gemini_generate_content", model: "llm-model-c" },
  },
  scenarioDecision: { backend: "llm-c" },
});

/** A table whose only use of `llm-c` is the turn decision, so only that key and price reach it. */
const TABLE = syntheticScenarioRouteTable({
  backends: {
    "llm-a": { kind: "anthropic_messages", model: "llm-model-a" },
    "llm-c": { kind: "openai_responses", model: "llm-model-c" },
  },
  scenarioDecision: { backend: "llm-c" },
});

const PRICING: InstantEvalJudgeRoutePricing = {
  ...SYNTHETIC_SCENARIO_PRICING,
  backends: {
    ...SYNTHETIC_SCENARIO_PRICING.backends,
    "llm-c": { usdPerMillionInputTokens: 3, usdPerMillionOutputTokens: 30 },
  },
};

async function boot({
  keys = ALL_KEYS,
  pricing = PRICING,
  isSaas = true,
  table = TABLE,
}: {
  /** Null boots on the public route table, as an install that sets none does. */
  table?: typeof TABLE | null;
  keys?: Record<string, string>;
  pricing?: InstantEvalJudgeRoutePricing;
  isSaas?: boolean;
}) {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: keys }).withEnv());
  const config = {
    classifierBaseUrl: undefined,
    classifierModel: undefined,
    globalTokensPerSecond: 300_000,
    tenantTokensPerSecond: 150_000,
    judgeRoutes: isSaas && table ? table : undefined,
    judgeRoutePricing: isSaas && table ? pricing : undefined,
    isSaas,
    nodeEnvironment: "production",
  };
  const secrets = resolver.scopeTo(
    "instant-eval-judge",
    Object.values(InstantEvalJudgeModule.secrets),
  );
  return InstantEvalJudgeModule.create({
    dependencies: {},
    repositories: MemoryInstantEvalJudgeRepositories.create(),
    channels: await HttpInstantEvalJudgeChannels.create({
      config,
      secrets,
      bound: { spend: MemoryInstantEvalProviderSpendChannel.create() },
    }),
    config,
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets,
  });
}

describe("InstantEvalJudgeModule.create with a scenario decision backend", () => {
  /** @scenario "Boot refuses a decision backend it cannot bill or call" */
  it("boots when the decision backend has a price and a key", async () => {
    await expect(boot({})).resolves.toBeInstanceOf(InstantEvalJudgeModule);
  });

  /** @scenario "Boot refuses a decision backend it cannot bill or call" */
  it("refuses a decision backend with no price, naming it", async () => {
    const { "llm-c": _unpriced, ...backends } = PRICING.backends;

    await expect(boot({ pricing: { ...PRICING, backends } })).rejects.toThrow(
      /backend llm-c: no price in the route pricing/,
    );
  });

  /** @scenario "Boot refuses a decision backend it cannot bill or call" */
  it("refuses a decision backend this install holds no key for", async () => {
    const { INSTANT_EVAL_OPENAI_API_KEY: _openAi, ...rest } = ALL_KEYS;

    await expect(boot({ keys: rest })).rejects.toThrow(
      /backend llm-c: no openai_responses key or channel on this install/,
    );
  });
});

describe("InstantEvalJudgeModule.isScenarioJudgeConfigured", () => {
  /** @scenario "Only a table with a turn decision backend can answer a scenario judge" */
  it("is false on the public route table, which names no decision backend", async () => {
    const module = await boot({ table: null });

    expect(await module.isScenarioJudgeConfigured()).toBe(false);
  });

  /** @scenario "Only a table with a turn decision backend can answer a scenario judge" */
  it("is false when the decision backend is switched off and lists no fallback", async () => {
    const off = syntheticScenarioRouteTable({
      backends: {
        "llm-a": { kind: "anthropic_messages", model: "llm-model-a" },
        "llm-c": { kind: "openai_responses", model: "llm-model-c", enabled: false },
      },
      scenarioDecision: { backend: "llm-c" },
    });

    expect(await (await boot({ table: off })).isScenarioJudgeConfigured()).toBe(false);
  });

  /** @scenario "Only a table with a turn decision backend can answer a scenario judge" */
  it("is true when the table names an enabled decision backend", async () => {
    expect(await (await boot({})).isScenarioJudgeConfigured()).toBe(true);
  });
});

describe("InstantEvalJudgeModule.create with a Gemini backend", () => {
  /** @scenario "Boot refuses a Gemini backend when the install holds no Gemini key" */
  it("boots when the install holds the Gemini key", async () => {
    await expect(boot({ table: GEMINI_TABLE })).resolves.toBeInstanceOf(InstantEvalJudgeModule);
  });

  /** @scenario "Boot refuses a Gemini backend when the install holds no Gemini key" */
  it("refuses when the install holds no Gemini key, naming the backend and its kind", async () => {
    const { INSTANT_EVAL_GEMINI_API_KEY: _gemini, ...rest } = ALL_KEYS;

    await expect(boot({ table: GEMINI_TABLE, keys: rest })).rejects.toThrow(
      /backend llm-c: no gemini_generate_content key or channel on this install/,
    );
  });
});

describe("InstantEvalJudgeModule.judgeScenario on a self-hosted install", () => {
  /** @scenario "A scenario judgement off LangWatch Cloud is refused and sends nothing" */
  it("refuses a verdict and a turn decision, whatever keys the environment holds", async () => {
    const module = await boot({ isSaas: false });

    const verdict = await module.judgeScenario(scenarioJudgeCall());
    const decision = await module.judgeScenario(scenarioJudgeCall({ phase: "decision" }));

    expect(verdict).toMatchObject({ outcome: "refused", code: "classifier_not_configured" });
    expect(decision).toMatchObject({ outcome: "refused", code: "classifier_not_configured" });
  });
});
