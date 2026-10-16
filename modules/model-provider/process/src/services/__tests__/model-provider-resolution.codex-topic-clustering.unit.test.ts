// Topic clustering is a FAST feature, but codex cannot execute it (it runs through
// langevals/litellm, not the gateway). A codex FAST default must be stepped over for it
// while still serving the other fast assists.

import { ModelRestrictedForFeatureError } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { ModelProviderResolutionService } from "../model-provider-resolution.service.ts";

const CODEX_MODEL = "openai_codex/gpt-5.6-terra";
const CLUSTERING = "analytics.topic_clustering_llm";
const GENERATOR = "scenarios.generator";
const EMBEDDINGS = "analytics.topic_clustering_embeddings";

const feature = (key: string, role: string) => ({
  key,
  role,
  displayName: key,
  description: `the ${key} feature`,
});

const config = (
  scopeType: "PROJECT" | "ORGANIZATION",
  scopeId: string,
  values: Record<string, string>,
) => ({
  id: `config-${scopeType}`,
  config: values,
  scopes: [{ scopeType, scopeId }],
  authorId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
});

function resolve(featureKey: string, configs: ReturnType<typeof config>[]) {
  return ModelProviderResolutionService.create({
    defaults: { findForOrganization: async () => configs, findForProject: async () => configs },
    catalog: {
      defaultFeatures: () => [
        feature(CLUSTERING, "FAST"),
        feature(GENERATOR, "FAST"),
        feature(EMBEDDINGS, "EMBEDDINGS"),
      ],
    },
    scopes: {
      getProjectContext: async () => ({ teamId: "team-1", organizationId: "organization-1" }),
      getProjectScopes: async () => [],
    },
  } as never).resolve({ projectId: "project-1", featureKey });
}

describe("ModelProviderResolutionService.resolve for a codex FAST default", () => {
  /** @scenario "A codex FAST default is skipped in favor of a wider tier" */
  it("resolves the organization model for topic clustering, skipping codex FAST", async () => {
    await expect(
      resolve(CLUSTERING, [
        config("PROJECT", "project-1", { FAST: CODEX_MODEL }),
        config("ORGANIZATION", "organization-1", { FAST: "openai/gpt-5-mini" }),
      ]),
    ).resolves.toMatchObject({
      model: "openai/gpt-5-mini",
      source: "role_default",
      scope: "organization",
    });
  });

  /** @scenario "A codex topic clustering override is skipped" */
  it("skips a codex per-feature override and resolves the organization FAST default", async () => {
    await expect(
      resolve(CLUSTERING, [
        config("PROJECT", "project-1", { [CLUSTERING]: CODEX_MODEL }),
        config("ORGANIZATION", "organization-1", { FAST: "openai/gpt-5-mini" }),
      ]),
    ).resolves.toMatchObject({ model: "openai/gpt-5-mini" });
  });

  /** @scenario "Exhaustion caused only by codex models reports the restriction, not missing configuration" */
  it("raises ModelRestrictedForFeatureError when only codex is set anywhere", async () => {
    await expect(
      resolve(CLUSTERING, [
        config("PROJECT", "project-1", { FAST: CODEX_MODEL }),
        config("ORGANIZATION", "organization-1", { FAST: CODEX_MODEL }),
      ]),
    ).rejects.toMatchObject({
      constructor: ModelRestrictedForFeatureError,
      meta: expect.objectContaining({ restrictedModels: [CODEX_MODEL] }),
    });
  });

  /** @scenario "Other fast assists still resolve the codex FAST default" */
  it("still resolves the codex FAST default for a runnable fast assist", async () => {
    await expect(
      resolve(GENERATOR, [config("PROJECT", "project-1", { FAST: CODEX_MODEL })]),
    ).resolves.toMatchObject({ model: CODEX_MODEL, source: "role_default", scope: "project" });
  });

  /** @scenario "Embeddings never resolve a codex model" */
  it("raises ModelRestrictedForFeatureError for an EMBEDDINGS codex value", async () => {
    await expect(
      resolve(EMBEDDINGS, [config("PROJECT", "project-1", { EMBEDDINGS: CODEX_MODEL })]),
    ).rejects.toBeInstanceOf(ModelRestrictedForFeatureError);
  });
});
