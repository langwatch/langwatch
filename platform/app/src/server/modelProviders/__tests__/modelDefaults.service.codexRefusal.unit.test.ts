/**
 * Save-time refusal pin for the new run-time agent-under-test key (issue
 * #6634, AC-N7) — mirrors the existing DEFAULT-role and feature-override
 * refusal pattern (setRoleAtScope / setFeatureAtScope, both already refuse
 * codex on every other DEFAULT-role feature; codexRestrictions.unit.test.ts
 * pins the underlying gate). Both refusals happen synchronously before any
 * database access, so a bogus `prisma` stands in safely — these tests never
 * reach it.
 *
 * @see specs/model-providers/codex-account-provider.feature
 *   ("The server refuses Codex outside the allowed surfaces")
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CODEX_DEFAULT_MODEL } from "../codexRestrictions";
import {
  createConfig,
  setFeatureAtScope,
  setRoleAtScope,
  updateConfig,
} from "../modelDefaults.service";

// In-memory stand-in for the repository: the stored config is the only
// state these tests care about, and the repository is our own boundary to
// the database.
const store = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  written: [] as Array<Record<string, unknown>>,
}));

vi.mock("../modelDefaults.repository", () => ({
  ModelDefaultsRepository: class {
    async lockOrganization() {}
    async lockScope() {}
    async organizationIdForScopes() {
      return "org-1";
    }
    async findOrganizationIdForConfig() {
      return "org-1";
    }
    async findConfigsAtScope() {
      return [{ id: "cfg-1", config: store.config, createdAt: new Date() }];
    }
    async findConfigById() {
      return store.config;
    }
    async findAttachmentsForScopes() {
      return [];
    }
    async findScopesForConfig() {
      return [{ id: "scope-1", scopeType: "PROJECT", scopeId: "proj-1" }];
    }
    async updateConfigScopes(params: {
      configPayload?: { config?: Record<string, unknown> };
    }) {
      if (params.configPayload?.config) {
        store.written.push(params.configPayload.config);
      }
    }
    async updateConfigPayload(params: {
      data: { config?: Record<string, unknown> };
    }) {
      if (params.data.config) store.written.push(params.data.config);
    }
  },
}));

const TOPIC_KEY = "analytics.topic_clustering_llm";
const OTHER_CODEX_MODEL = "openai_codex/gpt-5.6-other";
// A non-root client: updateConfig runs on it directly, and the upsert path
// only needs $transaction to hand it back.
const fakeTx = {};
const fakePrisma = {
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
} as never;

// Neither refusal path under test reaches the database — both throw
// synchronously from validation before any prisma call.
const unusedPrisma = undefined as never;

describe("modelDefaults.service — codex refusal for the run-time agent-under-test surface", () => {
  describe("given a DEFAULT role default set to a codex model", () => {
    /** @scenario "The server refuses Codex outside the allowed surfaces" */
    it("refuses the write", async () => {
      await expect(
        setRoleAtScope(
          { prisma: unusedPrisma },
          {
            scopeType: "PROJECT",
            scopeId: "proj-1",
            role: "DEFAULT",
            model: CODEX_DEFAULT_MODEL,
          },
        ),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe("given a scenarios.agent_under_test feature override set to a codex model", () => {
    /** @scenario "The server refuses Codex outside the allowed surfaces" */
    it("refuses the write", async () => {
      await expect(
        setFeatureAtScope(
          { prisma: unusedPrisma },
          {
            scopeType: "PROJECT",
            scopeId: "proj-1",
            featureKey: "scenarios.agent_under_test",
            model: CODEX_DEFAULT_MODEL,
          },
        ),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe("given a config storing a codex value for topic clustering", () => {
    beforeEach(() => {
      store.config = { [TOPIC_KEY]: CODEX_DEFAULT_MODEL };
      store.written = [];
    });

    describe("when a different key is set at the scope", () => {
      /** @scenario "A saved Codex clustering override does not block other default-model changes" */
      it("saves and keeps the stored codex value untouched", async () => {
        await setRoleAtScope(
          { prisma: fakePrisma },
          {
            scopeType: "PROJECT",
            scopeId: "proj-1",
            role: "DEFAULT",
            model: "openai/gpt-5-mini",
          },
        );

        expect(store.written).toEqual([
          { [TOPIC_KEY]: CODEX_DEFAULT_MODEL, DEFAULT: "openai/gpt-5-mini" },
        ]);
      });
    });

    describe("when the full config is saved back with the stored value unchanged", () => {
      /** @scenario "A saved Codex clustering override does not block other default-model changes" */
      it("saves and keeps the stored codex value untouched", async () => {
        await updateConfig(
          { prisma: fakeTx as never },
          {
            id: "cfg-1",
            config: {
              [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
              FAST: "openai/gpt-5-mini",
            },
          },
        );

        expect(store.written).toEqual([
          { [TOPIC_KEY]: CODEX_DEFAULT_MODEL, FAST: "openai/gpt-5-mini" },
        ]);
      });
    });

    describe("when the drawer saves with scopes and the stored codex value unchanged", () => {
      /** @scenario "A saved Codex clustering override does not block other default-model changes" */
      it("saves and keeps the stored codex value untouched", async () => {
        await updateConfig(
          { prisma: fakePrisma },
          {
            id: "cfg-1",
            config: {
              [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
              FAST: "openai/gpt-5-mini",
            },
            scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
          },
        );

        expect(store.written).toEqual([
          { [TOPIC_KEY]: CODEX_DEFAULT_MODEL, FAST: "openai/gpt-5-mini" },
        ]);
      });
    });

    describe("when a different codex value is written for topic clustering", () => {
      /** @scenario "Saving a new Codex model for topic clustering is still rejected" */
      it("refuses the write", async () => {
        await expect(
          updateConfig(
            { prisma: fakeTx as never },
            { id: "cfg-1", config: { [TOPIC_KEY]: OTHER_CODEX_MODEL } },
          ),
        ).rejects.toThrow(/coding-assistant surfaces only/);
        expect(store.written).toEqual([]);
      });
    });
  });

  describe("given a new config with a codex value for topic clustering", () => {
    /** @scenario "Saving a new Codex model for topic clustering is still rejected" */
    it("refuses the create", async () => {
      await expect(
        createConfig(
          { prisma: unusedPrisma },
          {
            config: { [TOPIC_KEY]: CODEX_DEFAULT_MODEL },
            scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
          },
        ),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });
});
