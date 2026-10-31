/**
 * The judge refuses to boot on a route table it cannot bill or call: a reachable backend with no
 * price, or no key and channel on this install.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 * @vitest-environment node
 */
import type { InstantEvalJudgeRoutePricing } from "@langwatch/instant-eval-judge-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { syntheticRouteTable } from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import { HttpInstantEvalJudgeChannels } from "../../channels/http/http.instant-eval-judge.channels.ts";
import { MemoryInstantEvalJudgeRepositories } from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeModule } from "../instant-eval-judge.app.ts";

const ALL_KEYS = {
  JEV_API_KEY: "jev-key",
  INSTANT_EVAL_DECISIONS_API_KEY: "decisions-key",
  INSTANT_EVAL_ANTHROPIC_API_KEY: "anthropic-key",
  INSTANT_EVAL_OPENAI_API_KEY: "openai-key",
};

const price = { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 };
const FULL_PRICING: InstantEvalJudgeRoutePricing = {
  version: "test",
  backends: { "decision-a": price, "decision-b": price, "llm-a": price, "llm-b": price },
};

async function boot({
  keys = ALL_KEYS,
  pricing = FULL_PRICING,
}: {
  keys?: Record<string, string>;
  /** Null leaves the price variable unset. */
  pricing?: InstantEvalJudgeRoutePricing | null;
}) {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: keys }).withEnv());
  const config = {
    classifierBaseUrl: undefined,
    classifierModel: undefined,
    globalTokensPerSecond: 300_000,
    tenantTokensPerSecond: 150_000,
    judgeRoutes: syntheticRouteTable(),
    judgeRoutePricing: pricing ?? undefined,
    isSaas: true,
    nodeEnvironment: "production",
  };
  const secrets = resolver.scopeTo(
    "instant-eval-judge",
    Object.values(InstantEvalJudgeModule.secrets),
  );
  return InstantEvalJudgeModule.create({
    dependencies: {},
    repositories: MemoryInstantEvalJudgeRepositories.create(),
    channels: await HttpInstantEvalJudgeChannels.create({ config, secrets }),
    config,
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets,
  });
}

describe("InstantEvalJudgeModule.create with a configured route table", () => {
  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("boots when every reachable backend has a price and a key", async () => {
    await expect(boot({})).resolves.toBeInstanceOf(InstantEvalJudgeModule);
  });

  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("refuses a table set without its prices, naming the unpriced backends", async () => {
    await expect(boot({ pricing: null })).rejects.toThrow(
      /backend decision-a: no price in the route pricing/,
    );
  });

  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("refuses a backend this install holds no key for", async () => {
    const { INSTANT_EVAL_DECISIONS_API_KEY: _decisions, ...rest } = ALL_KEYS;
    await expect(boot({ keys: rest })).rejects.toThrow(
      /backend decision-a: no decisions key or channel on this install/,
    );
  });
});
