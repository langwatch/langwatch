/**
 * `release_dashboards_in_every_product` is on by default (2026-11-23): the browser's flag map
 * carries it on with no operator row, environment override or force-enable.
 * Spec: modules/feature-flag/specs/feature-flag.feature.
 */
import { describe, expect, it } from "vitest";

import {
  createFeatureFlagTestService,
  resolveTestFeatureFlagConfig,
} from "../app/__tests__/feature-flag.fixture.ts";

const PROJECT = {
  kind: "project",
  userId: "user-1",
  projectId: "project-shop",
  organizationId: "org-1",
} as const;

function buildService({ isSaas }: { isSaas: boolean }) {
  return createFeatureFlagTestService({
    config: resolveTestFeatureFlagConfig(isSaas ? { IS_SAAS: "true" } : {}),
  }).service;
}

describe("the release_dashboards_in_every_product default", () => {
  describe.each([
    { deployment: "LangWatch Cloud", isSaas: true },
    { deployment: "a self-hosted install", isSaas: false },
  ])("given $deployment with nothing setting the flag", ({ isSaas }) => {
    describe("when the browser reads its flags for a project", () => {
      /** @scenario "Dashboards in every product is on by default" */
      it("carries the flag on", async () => {
        const flags = await buildService({ isSaas }).resolveFrontendFlags(PROJECT);

        expect(flags.release_dashboards_in_every_product).toBe(true);
      });
    });
  });
});
