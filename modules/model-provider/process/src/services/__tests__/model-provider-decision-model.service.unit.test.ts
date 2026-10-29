/**
 * Which decision model a project's Instant Evals run on: the stored column, the organization's
 * flag and the provider row (ADR-182 decisions 4 and 5).
 * @see specs/model-providers/instant-evals-decision-model.feature
 */
import {
  LANGWATCH_DECISION_MODEL_ID,
  ModelNotConfiguredError,
  ModelRestrictedForFeatureError,
  type ModelProvider,
  type ModelProviderResolution,
} from "@langwatch/model-provider-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ModelProviderDecisionModelService } from "../model-provider-decision-model.service.ts";

const OPENAI_DECISIONS = "openai/decisions:gpt-6-luna";
const INCEPTION_DECISIONS = "inception/decisions:mercury-decide";
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
  rowsByProvider,
}: {
  /** The column value, or the error resolving it throws. */
  stored: string | Error;
  isFlagOn?: boolean;
  row?: ModelProvider | null;
  /** When given, answers per provider instead of the one `row`; an absent provider has no row. */
  rowsByProvider?: Readonly<Record<string, ModelProvider>>;
}) {
  const lookups: string[] = [];
  const providerLookups: string[] = [];
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
    findProviderForProject: async ({ provider }) => {
      providerLookups.push(provider);
      return rowsByProvider ? (rowsByProvider[provider] ?? null) : row;
    },
    isOwnModelAllowed: async () => isFlagOn,
    now: () => Temporal.Instant.fromEpochMilliseconds(nowMs),
  });
  return {
    service,
    lookups,
    providerLookups,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function rowOf({
  provider,
  customKeys,
}: {
  provider: string;
  customKeys: Readonly<Record<string, unknown>>;
}): ModelProvider {
  return { ...openAiRow(), provider, name: provider, customKeys };
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

  describe("when a caller picks a decision model of its own", () => {
    /** @scenario "A caller's own decision model pick is resolved instead of the column" */
    it("resolves the pick and never reads the project's column", async () => {
      const { service, lookups } = harness({
        stored: new ModelNotConfiguredError({ ...UNSET_ERROR.feature, ...UNSET_ERROR.rest }),
      });

      expect(await service.resolve({ projectId: "proj_1", model: OPENAI_DECISIONS })).toMatchObject(
        { kind: "own", model: OPENAI_DECISIONS, apiKey: "customer-key" },
      );
      expect(lookups).toEqual([]);
    });

    /** @scenario "A caller's pick with no key cannot run and is not moved onto the billed model" */
    it("answers own_unavailable for a pick whose provider has no row", async () => {
      const { service } = harness({ stored: OPENAI_DECISIONS, rowsByProvider: {} });

      expect(await service.resolve({ projectId: "proj_1", model: INCEPTION_DECISIONS })).toEqual({
        kind: "own_unavailable",
        model: INCEPTION_DECISIONS,
        reason: "provider_missing",
      });
    });

    /** @scenario "A caller's pick is refused without the flag" */
    it("answers own_unavailable as not enabled when the flag is off", async () => {
      const { service } = harness({
        stored: new ModelNotConfiguredError({ ...UNSET_ERROR.feature, ...UNSET_ERROR.rest }),
        isFlagOn: false,
      });

      expect(await service.resolve({ projectId: "proj_1", model: OPENAI_DECISIONS })).toEqual({
        kind: "own_unavailable",
        model: OPENAI_DECISIONS,
        reason: "not_enabled",
      });
    });

    /** @scenario "A caller picking LangWatch Instant Preview runs on the hosted model" */
    it("answers langwatch for the hosted id, whatever the column holds", async () => {
      const { service, providerLookups } = harness({ stored: OPENAI_DECISIONS });

      expect(
        await service.resolve({ projectId: "proj_1", model: LANGWATCH_DECISION_MODEL_ID }),
      ).toEqual({ kind: "langwatch" });
      expect(providerLookups).toEqual([]);
    });

    /** @scenario "A caller's pick that is not a decision model is ignored" */
    it("falls back to the column for a value that is not a decision model", async () => {
      const { service, lookups } = harness({ stored: OPENAI_DECISIONS });

      expect(await service.resolve({ projectId: "proj_1", model: "openai/gpt-5.5" })).toMatchObject(
        { kind: "own", model: OPENAI_DECISIONS },
      );
      expect(lookups).toEqual(["proj_1"]);
    });

    /** @scenario "One caller's pick never answers for another caller" */
    it("keeps the pick out of the plain project answer", async () => {
      const { service } = harness({
        stored: new ModelNotConfiguredError({ ...UNSET_ERROR.feature, ...UNSET_ERROR.rest }),
      });

      await service.resolve({ projectId: "proj_1", model: OPENAI_DECISIONS });

      expect(await service.resolve({ projectId: "proj_1" })).toEqual({ kind: "langwatch" });
    });
  });
});

describe("ModelProviderDecisionModelService.listPickable", () => {
  /** @scenario "With the flag off only LangWatch Instant Preview is offered" */
  it("offers the hosted model alone when the flag is off", async () => {
    const { service } = harness({ stored: OPENAI_DECISIONS, isFlagOn: false });

    expect(await service.listPickable({ projectId: "proj_1" })).toEqual([
      { value: LANGWATCH_DECISION_MODEL_ID, label: "LangWatch Instant Preview" },
    ]);
  });

  /** @scenario "With the flag on the models that would run are offered" */
  it("offers the hosted model first, then only own models that would run", async () => {
    const { service } = harness({
      stored: OPENAI_DECISIONS,
      rowsByProvider: {
        openai: rowOf({ provider: "openai", customKeys: { OPENAI_API_KEY: "k" } }),
      },
    });

    const offered = await service.listPickable({ projectId: "proj_1" });

    expect(offered.map((model) => model.value)).toEqual([
      LANGWATCH_DECISION_MODEL_ID,
      OPENAI_DECISIONS,
    ]);
    expect(offered[1]?.label).toBe("OpenAI Decisions (gpt-6-luna)");
  });

  /** @scenario "A provider is asked for once however many of its models the catalogue holds" */
  it("asks a provider for its row once and offers both of its models", async () => {
    const { service, providerLookups } = harness({
      stored: OPENAI_DECISIONS,
      rowsByProvider: {
        perplexity: rowOf({ provider: "perplexity", customKeys: { PERPLEXITY_API_KEY: "k" } }),
      },
    });

    const offered = await service.listPickable({ projectId: "proj_1" });

    expect(offered.map((model) => model.value)).toEqual([
      LANGWATCH_DECISION_MODEL_ID,
      "perplexity/decisions:pplx-decider-v1.2",
      "perplexity/decisions:pplx-decider-flash-v1.2",
    ]);
    expect(providerLookups.filter((provider) => provider === "perplexity")).toEqual(["perplexity"]);
  });
});
