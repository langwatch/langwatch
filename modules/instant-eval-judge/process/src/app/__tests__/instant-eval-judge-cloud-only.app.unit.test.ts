/**
 * The judge app builds a classifier from LangWatch's key on LangWatch Cloud only (ADR-174
 * decision 14): the app as production composes it, with the key resolved through its secrets.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 * @vitest-environment node
 */
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { MemoryInstantEvalJudgeRepositories } from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeModule } from "../instant-eval-judge.app.ts";

async function judgeAppWith({ isCloud, apiKey }: { isCloud: boolean; apiKey?: string }) {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: apiKey ? { JEV_API_KEY: apiKey } : {} }).withEnv(),
  );
  return InstantEvalJudgeModule.create({
    dependencies: {},
    repositories: MemoryInstantEvalJudgeRepositories.create(),
    config: {
      classifierBaseUrl: undefined,
      classifierModel: undefined,
      globalTokensPerSecond: 300_000,
      tenantTokensPerSecond: 150_000,
      isSaas: isCloud,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: resolver.scopeTo("instant-eval-judge", Object.values(InstantEvalJudgeModule.secrets)),
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
    it("builds no classifier", async () => {
      const app = await judgeAppWith({ isCloud: true });

      expect(await app.isClassifierConfigured()).toBe(false);
    });
  });
});
