/**
 * A flag's self-hosted default: what an install with `IS_SAAS` unset resolves to when nothing
 * overrides the flag, while LangWatch Cloud keeps the registry default.
 */
import { describe, expect, it } from "vitest";

import {
  createFeatureFlagTestService,
  resolveTestFeatureFlagConfig,
} from "../app/__tests__/feature-flag.fixture.ts";

const ROUTER_FLAG = "release_instant_evals_judge_router";
const TARGET = { kind: "project", projectId: "project-1", organizationId: "org-1" } as const;

function buildService({ isSaas }: { isSaas: boolean }) {
  return createFeatureFlagTestService({
    config: resolveTestFeatureFlagConfig(isSaas ? { IS_SAAS: "true" } : {}),
  }).service;
}

describe("FeatureFlagService self-hosted default", () => {
  describe("given the judge router flag, on in the registry and off on self-hosted", () => {
    describe("when a self-hosted install resolves it with nothing overriding it", () => {
      /** @scenario "A self-hosted install resolves a flag to its self-hosted default" */
      it("resolves off", async () => {
        const service = buildService({ isSaas: false });

        expect(await service.isEnabled(ROUTER_FLAG, TARGET)).toBe(false);
      });

      /** @scenario "A self-hosted install resolves a flag to its self-hosted default" */
      it("shows off as the default in the operator catalogue", async () => {
        const service = buildService({ isSaas: false });

        const { flags } = await service.listOperatorCatalogue();
        const router = flags.find(({ key }) => key === ROUTER_FLAG);

        expect(router).toMatchObject({ defaultValue: false, effective: false });
      });
    });

    describe("when LangWatch Cloud resolves it with nothing overriding it", () => {
      /** @scenario "A self-hosted install resolves a flag to its self-hosted default" */
      it("resolves on", async () => {
        const service = buildService({ isSaas: true });

        expect(await service.isEnabled(ROUTER_FLAG, TARGET)).toBe(true);
      });
    });

    describe("when an operator switches it on for a self-hosted install", () => {
      /** @scenario "An operator row overrides the self-hosted default" */
      it("resolves on", async () => {
        const service = buildService({ isSaas: false });
        await service.setEnabled({ key: ROUTER_FLAG, enabled: true, lastEditedBy: "operator-1" });

        expect(await service.isEnabled(ROUTER_FLAG, TARGET)).toBe(true);
      });
    });
  });
});
