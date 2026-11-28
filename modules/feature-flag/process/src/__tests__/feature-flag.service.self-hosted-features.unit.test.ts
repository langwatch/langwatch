/**
 * Shipped features a self-hosted install gets with no rule, while LangWatch Cloud keeps rolling
 * them out by its own rules.
 */
import { FEATURE_FLAGS } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import {
  createFeatureFlagTestService,
  resolveTestFeatureFlagConfig,
} from "../app/__tests__/feature-flag.fixture.ts";

const TARGET = { kind: "project", projectId: "project-1", organizationId: "org-1" } as const;
const ROUTER_FLAG = "release_instant_evals_judge_router";

function buildService({ isSaas }: { isSaas: boolean }) {
  return createFeatureFlagTestService({
    config: resolveTestFeatureFlagConfig(isSaas ? { IS_SAAS: "true" } : {}),
  }).service;
}

describe("FeatureFlagService features a self-hosted install gets by default", () => {
  describe("given release_lwql_workbench", () => {
    /** @scenario "LangWatchQL is on by default on a self-hosted install" */
    it("resolves on for a self-hosted install with nothing overriding it", async () => {
      const service = buildService({ isSaas: false });

      expect(await service.isEnabled("release_lwql_workbench", TARGET)).toBe(true);
    });

    /** @scenario "LangWatchQL is on by default on a self-hosted install" */
    it("resolves off on LangWatch Cloud with no rule", async () => {
      const service = buildService({ isSaas: true });

      expect(await service.isEnabled("release_lwql_workbench", TARGET)).toBe(false);
    });
  });

  describe("given release_instant_evals", () => {
    /** @scenario "The Instant Evals release flag is on by default on a self-hosted install" */
    it("resolves on for a self-hosted install with nothing overriding it", async () => {
      const service = buildService({ isSaas: false });

      expect(await service.isEnabled("release_instant_evals", TARGET)).toBe(true);
    });

    /** @scenario "The Instant Evals release flag is on by default on a self-hosted install" */
    it("resolves off on LangWatch Cloud with no rule", async () => {
      const service = buildService({ isSaas: true });

      expect(await service.isEnabled("release_instant_evals", TARGET)).toBe(false);
    });
  });

  describe("given every flag on by default on LangWatch Cloud", () => {
    const onInCloud = FEATURE_FLAGS.filter((flag) => flag.defaultValue && flag.key !== ROUTER_FLAG);

    /** @scenario "A self-hosted install never loses a feature LangWatch Cloud has on by default" */
    it.each(onInCloud.map((flag) => flag.key))(
      "resolves %s on for a self-hosted install too",
      async (key) => {
        expect(await buildService({ isSaas: false }).isEnabled(key, TARGET)).toBe(true);
      },
    );

    /** @scenario "A self-hosted install never loses a feature LangWatch Cloud has on by default" */
    it("keeps the judge router off on a self-hosted install", async () => {
      expect(await buildService({ isSaas: false }).isEnabled(ROUTER_FLAG, TARGET)).toBe(false);
    });
  });
});
