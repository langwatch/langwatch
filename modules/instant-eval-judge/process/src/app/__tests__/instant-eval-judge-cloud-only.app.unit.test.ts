/**
 * The judge's channel tiers build a classifier from LangWatch's key on LangWatch Cloud only
 * (ADR-174 decision 14); the app holds what the chosen tier built.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 * @see modules/instant-eval-judge/specs/instant-eval-judge-classifier.feature
 * @vitest-environment node
 */
import type { Tier } from "@langwatch/process";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { HttpInstantEvalJudgeChannels } from "../../channels/http/http.instant-eval-judge.channels.ts";
import { MemoryInstantEvalJudgeChannels } from "../../channels/memory/memory.instant-eval-judge.channels.ts";
import { MemoryInstantEvalJudgeRepositories } from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeModule } from "../instant-eval-judge.app.ts";

async function judgeAppWith({
  isCloud,
  apiKey,
  tier = "live",
}: {
  isCloud: boolean;
  apiKey?: string;
  tier?: Tier;
}) {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: apiKey ? { JEV_API_KEY: apiKey } : {} }).withEnv(),
  );
  const config = {
    classifierBaseUrl: undefined,
    classifierModel: undefined,
    globalTokensPerSecond: 300_000,
    tenantTokensPerSecond: 150_000,
    isSaas: isCloud,
  };
  const secrets = resolver.scopeTo(
    "instant-eval-judge",
    Object.values(InstantEvalJudgeModule.secrets),
  );
  const channels =
    tier === "live"
      ? await HttpInstantEvalJudgeChannels.create({ config, secrets })
      : MemoryInstantEvalJudgeChannels.create();
  return InstantEvalJudgeModule.create({
    dependencies: {},
    repositories: MemoryInstantEvalJudgeRepositories.create(),
    channels,
    config,
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets,
  });
}

describe("InstantEvalJudgeModule.create", () => {
  describe("given a self-hosted install that sets a judge key", () => {
    /** @scenario "A self-hosted install never judges with a judge key it sets" */
    it("builds no classifier, so a judge call is not configured", async () => {
      const app = await judgeAppWith({ isCloud: false, apiKey: "install-key" });

      expect(await app.isClassifierConfigured()).toBe(false);
      expect(
        await app.classify({ projectId: "project-1", text: "hello", questions: [] }),
      ).toMatchObject({ verdicts: [], skippedReason: "classifier_not_configured" });
    });
  });

  describe("given LangWatch Cloud with LangWatch's key", () => {
    it("builds the classifier", async () => {
      const app = await judgeAppWith({ isCloud: true, apiKey: "langwatch-key" });

      expect(await app.isClassifierConfigured()).toBe(true);
    });
  });

  describe("given LangWatch Cloud without the key", () => {
    /** @scenario "LangWatch Cloud without the classifier key holds no classifier" */
    it("builds no classifier", async () => {
      const app = await judgeAppWith({ isCloud: true });

      expect(await app.isClassifierConfigured()).toBe(false);
    });
  });

  describe("given the memory tier on LangWatch Cloud with LangWatch's key", () => {
    /** @scenario "A process on the memory tier holds no classifier" */
    it("builds no classifier, so a classify call is not configured", async () => {
      const app = await judgeAppWith({ isCloud: true, apiKey: "langwatch-key", tier: "memory" });

      expect(await app.isClassifierConfigured()).toBe(false);
      expect(
        await app.classify({ projectId: "project-1", text: "hello", questions: [] }),
      ).toMatchObject({ verdicts: [], skippedReason: "classifier_not_configured" });
    });
  });
});
