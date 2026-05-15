/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for the model resolver. Walks the
 * scope chain + per-feature override storage and exercises the full
 * order: feature override → role default → legacy B2 column → constant
 * → ModelNotConfiguredError. See
 * specs/model-providers/model-resolver-and-registry.feature.
 */
import { nanoid } from "nanoid";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "../../../utils/constants";
import { prisma } from "../../db";
import {
  ModelNotConfiguredError,
  MODEL_NOT_CONFIGURED_CAUSE,
} from "../modelNotConfiguredError";
import { resolveModelForFeature } from "../resolveModelForFeature";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)("resolveModelForFeature (real DB)", () => {
  const ns = `mp-resolve-${nanoid(8)}`;

  let organizationId: string;
  let teamId: string;
  let projectId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Resolver Org ${ns}`, slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: `Team ${ns}`,
        slug: `--team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: `Project ${ns}`,
        slug: `--proj-${ns}`,
        teamId: team.id,
        language: "typescript",
        framework: "other",
        apiKey: `test-key-${ns}`,
      },
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await prisma.modelDefault.deleteMany({
      where: {
        OR: [
          { scopeType: "PROJECT", scopeId: projectId },
          { scopeType: "TEAM", scopeId: teamId },
          { scopeType: "ORGANIZATION", scopeId: organizationId },
        ],
      },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: {
        defaultModel: null,
        topicClusteringModel: null,
        embeddingsModel: null,
      },
    });
    await prisma.team.update({
      where: { id: teamId },
      data: {
        defaultModel: null,
        topicClusteringModel: null,
        embeddingsModel: null,
      },
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        defaultModel: null,
        topicClusteringModel: null,
        embeddingsModel: null,
      },
    });
  });

  describe("when nothing is configured anywhere", () => {
    /** @scenario A feature with nothing configured falls back to the built-in constant */
    it("returns the built-in DEFAULT constant for a default-role feature", async () => {
      const r = await resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId,
      });
      expect(r.model).toBe(DEFAULT_MODEL);
      expect(r.source).toBe("constant");
      expect(r.scope).toBeNull();
      expect(r.feature.role).toBe("DEFAULT");
    });

    it("returns the built-in EMBEDDINGS constant for an embeddings feature", async () => {
      const r = await resolveModelForFeature(
        "analytics.topic_clustering_embeddings",
        { prisma, projectId },
      );
      expect(r.model).toBe(DEFAULT_EMBEDDINGS_MODEL);
      expect(r.source).toBe("constant");
      expect(r.scope).toBeNull();
    });

    it("returns the built-in FAST constant for a fast feature", async () => {
      const r = await resolveModelForFeature("traces.ai_search", {
        prisma,
        projectId,
      });
      expect(r.model).toBe(DEFAULT_TOPIC_CLUSTERING_MODEL);
      expect(r.source).toBe("constant");
    });
  });

  describe("when a role-level org default is set", () => {
    /** @scenario A role-level org default propagates to every feature in that role */
    it("propagates to every feature in that role", async () => {
      await prisma.modelDefault.create({
        data: {
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          role: "DEFAULT",
          featureKey: null,
          model: "openai/gpt-5.5",
        },
      });
      const a = await resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId,
      });
      const b = await resolveModelForFeature("evaluator.create_default", {
        prisma,
        projectId,
      });
      for (const r of [a, b]) {
        expect(r.model).toBe("openai/gpt-5.5");
        expect(r.source).toBe("role_default");
        expect(r.scope).toBe("organization");
      }
    });
  });

  describe("when a project-level role default exists alongside an org-level one", () => {
    /** @scenario A project-level role default beats an organization-level role default */
    it("the project-level value wins", async () => {
      await prisma.modelDefault.create({
        data: {
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          role: "DEFAULT",
          featureKey: null,
          model: "openai/gpt-5.5",
        },
      });
      await prisma.modelDefault.create({
        data: {
          scopeType: "PROJECT",
          scopeId: projectId,
          role: "DEFAULT",
          featureKey: null,
          model: "openai/gpt-5.4-mini",
        },
      });
      const r = await resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId,
      });
      expect(r.model).toBe("openai/gpt-5.4-mini");
      expect(r.source).toBe("role_default");
      expect(r.scope).toBe("project");
    });
  });

  describe("when a per-feature override exists", () => {
    /** @scenario A feature override beats every role-level default */
    it("the feature override beats the role default", async () => {
      await prisma.modelDefault.create({
        data: {
          scopeType: "PROJECT",
          scopeId: projectId,
          role: "FAST",
          featureKey: null,
          model: "openai/gpt-5.4-mini",
        },
      });
      await prisma.modelDefault.create({
        data: {
          scopeType: "PROJECT",
          scopeId: projectId,
          role: "FAST",
          featureKey: "traces.ai_search",
          model: "anthropic/claude-sonnet-4-5",
        },
      });
      const r = await resolveModelForFeature("traces.ai_search", {
        prisma,
        projectId,
      });
      expect(r.model).toBe("anthropic/claude-sonnet-4-5");
      expect(r.source).toBe("feature_override");
      expect(r.scope).toBe("project");
    });

    /** @scenario A team-level feature override beats an organization-level role default */
    it("a team-level feature override beats an organization-level role default", async () => {
      await prisma.modelDefault.create({
        data: {
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          role: "FAST",
          featureKey: null,
          model: "openai/gpt-5.4-mini",
        },
      });
      await prisma.modelDefault.create({
        data: {
          scopeType: "TEAM",
          scopeId: teamId,
          role: "FAST",
          featureKey: "studio.autocomplete",
          model: "anthropic/claude-haiku-4-5",
        },
      });
      const r = await resolveModelForFeature("studio.autocomplete", {
        prisma,
        projectId,
      });
      expect(r.model).toBe("anthropic/claude-haiku-4-5");
      expect(r.source).toBe("feature_override");
      expect(r.scope).toBe("team");
    });
  });

  describe("when a sibling feature has an override", () => {
    /** @scenario A sibling feature override does not leak across features */
    it("the override does not leak across features", async () => {
      await prisma.modelDefault.create({
        data: {
          scopeType: "PROJECT",
          scopeId: projectId,
          role: "FAST",
          featureKey: "traces.ai_search",
          model: "openai/gpt-5.5",
        },
      });
      // studio.autocomplete has no override and no role default → falls
      // through to the FAST constant (DEFAULT_TOPIC_CLUSTERING_MODEL).
      const r = await resolveModelForFeature("studio.autocomplete", {
        prisma,
        projectId,
      });
      expect(r.model).toBe(DEFAULT_TOPIC_CLUSTERING_MODEL);
      expect(r.source).toBe("constant");
    });
  });

  describe("when the legacy B2 column is the only source", () => {
    /** @scenario Resolver falls back to legacy columns for one release */
    it("falls back to the legacy Organization.defaultModel column", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { defaultModel: "anthropic/claude-sonnet-4-6" },
      });
      const r = await resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId,
      });
      expect(r.model).toBe("anthropic/claude-sonnet-4-6");
      expect(r.source).toBe("role_default");
      expect(r.scope).toBe("organization");
    });

    it("falls back to the legacy topicClusteringModel column for the LLM feature", async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { topicClusteringModel: "openai/gpt-5.2-custom" },
      });
      const r = await resolveModelForFeature(
        "analytics.topic_clustering_llm",
        { prisma, projectId },
      );
      expect(r.model).toBe("openai/gpt-5.2-custom");
      expect(r.source).toBe("role_default");
      expect(r.scope).toBe("organization");
    });
  });

  describe("when there is no model anywhere and no constant", () => {
    it("falls back gracefully on every role because every role has a constant today", async () => {
      // We currently have constants for all three roles, so the no-config
      // path always lands on `constant`. Locked in so a future change that
      // removes a role's constant must update this expectation explicitly.
      const roles = [
        "prompt.create_default",
        "traces.ai_search",
        "analytics.topic_clustering_embeddings",
      ];
      for (const key of roles) {
        const r = await resolveModelForFeature(key, { prisma, projectId });
        expect(r.source).toBe("constant");
      }
    });
  });

  describe("when callers use the wrong feature key", () => {
    /** @scenario Looking up an unknown feature key throws */
    it("throws a clear error", async () => {
      await expect(
        resolveModelForFeature("not-in-registry", { prisma, projectId }),
      ).rejects.toThrow(/Unknown feature key/);
    });
  });

  describe("ModelNotConfiguredError shape", () => {
    /** @scenario ModelNotConfiguredError surfaces enough for the popup to render */
    it("carries featureKey, role, displayName, projectId and a stable cause", () => {
      const err = new ModelNotConfiguredError(
        "traces.ai_search",
        "FAST",
        "AI search",
        projectId,
      );
      expect(err.cause).toBe(MODEL_NOT_CONFIGURED_CAUSE);
      expect(err.featureKey).toBe("traces.ai_search");
      expect(err.role).toBe("FAST");
      expect(err.featureDisplayName).toBe("AI search");
      expect(err.projectId).toBe(projectId);
      expect(err.toResponseBody()).toEqual({
        cause: "MODEL_NOT_CONFIGURED",
        featureKey: "traces.ai_search",
        role: "FAST",
        featureDisplayName: "AI search",
        projectId,
      });
    });
  });
});
