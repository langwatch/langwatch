/**
 * Which decision model a project's Instant Evals run on: the stored column, the organization's
 * flag and the provider row (ADR-182 decisions 4 and 5).
 * @see specs/model-providers/instant-evals-decision-model.feature
 */
import {
  ModelNotConfiguredError,
  ModelRestrictedForFeatureError,
  type ModelProvider,
  type ModelProviderResolution,
} from "@langwatch/model-provider-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ModelProviderDecisionModelService } from "../model-provider-decision-model.service.ts";

const OPENAI_DECISIONS = "openai/decisions:gpt-6-luna";
const UNSET_ERROR = {
  feature: { featureKey: "instant_eval.judge", role: "INSTANT_EVALS" as const },
  rest: { featureDisplayName: "Instant Evals", projectId: "proj_1" },
};

function resolutionOf(model: string): ModelProviderResolution {
  return {
    model,
    source: "role_default",
    scope: "organization",
    feature: {
      key: "instant_eval.judge",
      role: "INSTANT_EVALS",
      displayName: "Instant Evals",
      description: "",
    },
  };
}

function openAiRow(): ModelProvider {
  const at = new Date(0);
  return {
    id: "mp_1",
    organizationId: "org_1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [],
    customKeys: { OPENAI_API_KEY: "customer-key" },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: at,
    updatedAt: at,
  };
}

function harness({
  stored,
  isFlagOn = true,
  row = openAiRow(),
}: {
  /** The column value, or the error resolving it throws. */
  stored: string | Error;
  isFlagOn?: boolean;
  row?: ModelProvider | null;
}) {
  const lookups: string[] = [];
  let nowMs = 0;
  const service = ModelProviderDecisionModelService.create({
    resolution: {
      resolve: async ({ projectId }) => {
        lookups.push(projectId);
        if (stored instanceof Error) throw stored;
        return resolutionOf(stored);
      },
    },
    scopes: {
      getProjectContext: async (projectId) => ({
        projectId,
        projectName: "Project",
        teamId: "team_1",
        organizationId: "org_1",
        organizationName: "Org",
      }),
    },
    findProviderForProject: async () => row,
    isOwnModelAllowed: async () => isFlagOn,
    now: () => Temporal.Instant.fromEpochMilliseconds(nowMs),
  });
  return {
    service,
    lookups,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("ModelProviderDecisionModelService.resolve", () => {
  describe("when the column is unset", () => {
    /** @scenario "An unset column runs on LangWatch Instant Preview" */
    it("answers langwatch", async () => {
      const { service } = harness({
        stored: new ModelNotConfiguredError({ ...UNSET_ERROR.feature, ...UNSET_ERROR.rest }),
      });

      expect(await service.resolve({ projectId: "proj_1" })).toEqual({ kind: "langwatch" });
    });
  });

  describe("when the stored model is no longer allowed for the feature", () => {
    it("reads as unset and answers langwatch", async () => {
      const { service } = harness({
        stored: new ModelRestrictedForFeatureError({
          ...UNSET_ERROR.feature,
          ...UNSET_ERROR.rest,
          restrictedModels: ["openai/gpt-5"],
        }),
      });

      expect(await service.resolve({ projectId: "proj_1" })).toEqual({ kind: "langwatch" });
    });
  });

  describe("when resolving the column fails for another reason", () => {
    it("throws rather than answering langwatch", async () => {
      const { service } = harness({ stored: new Error("database down") });

      await expect(service.resolve({ projectId: "proj_1" })).rejects.toThrow("database down");
    });

    it("does not keep the failure, so the next call asks again", async () => {
      const { service, lookups } = harness({ stored: new Error("database down") });

      await expect(service.resolve({ projectId: "proj_1" })).rejects.toThrow("database down");
      await expect(service.resolve({ projectId: "proj_1" })).rejects.toThrow("database down");

      expect(lookups).toEqual(["proj_1", "proj_1"]);
    });
  });

  describe("when the flag is off for the organization", () => {
    /** @scenario "With the flag off an own decision model is not run and not moved onto the billed model" */
    it("answers own_unavailable as not enabled, never langwatch", async () => {
      const { service } = harness({ stored: OPENAI_DECISIONS, isFlagOn: false });

      expect(await service.resolve({ projectId: "proj_1" })).toEqual({
        kind: "own_unavailable",
        model: OPENAI_DECISIONS,
        reason: "not_enabled",
      });
    });
  });

  describe("when the flag is on and the provider row has a key", () => {
    it("answers own with the catalogue's endpoint and the decrypted key", async () => {
      const { service } = harness({ stored: OPENAI_DECISIONS });

      expect(await service.resolve({ projectId: "proj_1" })).toMatchObject({
        kind: "own",
        model: OPENAI_DECISIONS,
        apiKey: "customer-key",
      });
    });
  });

  describe("when the flag is on and the project has no provider row", () => {
    it("answers own_unavailable as provider missing", async () => {
      const { service } = harness({ stored: OPENAI_DECISIONS, row: null });

      expect(await service.resolve({ projectId: "proj_1" })).toMatchObject({
        kind: "own_unavailable",
        reason: "provider_missing",
      });
    });
  });

  describe("when the same project is asked again", () => {
    it("shares one lookup across concurrent callers", async () => {
      const { service, lookups } = harness({ stored: OPENAI_DECISIONS });

      await Promise.all([
        service.resolve({ projectId: "proj_1" }),
        service.resolve({ projectId: "proj_1" }),
      ]);

      expect(lookups).toEqual(["proj_1"]);
    });

    it("asks again once the minute has passed", async () => {
      const { service, lookups, advance } = harness({ stored: OPENAI_DECISIONS });

      await service.resolve({ projectId: "proj_1" });
      advance(60_001);
      await service.resolve({ projectId: "proj_1" });

      expect(lookups).toEqual(["proj_1", "proj_1"]);
    });
  });
});
