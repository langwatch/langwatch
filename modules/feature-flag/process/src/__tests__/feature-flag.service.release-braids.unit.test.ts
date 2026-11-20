/**
 * `release_braids` is the kill switch for braid management, on by default (Alex, 2026-11-18),
 * resolved for an organisation through the real service with no operator row or override.
 * Spec: modules/authz/specs/braids-release-flag.feature.
 */
import { describe, expect, it } from "vitest";

import {
  createFeatureFlagTestService,
  resolveTestFeatureFlagConfig,
} from "../app/__tests__/feature-flag.fixture.ts";

const RELEASE_BRAIDS = "release_braids";
const ORGANIZATION = { kind: "organization", organizationId: "org-1" } as const;
const PROJECT = { kind: "project", projectId: "project-1", organizationId: "org-1" } as const;

function buildService({ isSaas }: { isSaas: boolean }) {
  return createFeatureFlagTestService({
    config: resolveTestFeatureFlagConfig(isSaas ? { IS_SAAS: "true" } : {}),
  }).service;
}

describe("the release_braids kill switch", () => {
  describe("given an organisation LangWatch has not switched off", () => {
    describe("when LangWatch Cloud reads release_braids for it", () => {
      /** @scenario "release_braids is on by default" */
      it("is on for the organisation and for its projects", async () => {
        const service = buildService({ isSaas: true });

        expect(await service.isEnabled(RELEASE_BRAIDS, ORGANIZATION)).toBe(true);
        expect(await service.isEnabled(RELEASE_BRAIDS, PROJECT)).toBe(true);
      });
    });

    describe("when a self-hosted install reads release_braids for it", () => {
      /** @scenario "release_braids is on by default" */
      it("is on", async () => {
        const service = buildService({ isSaas: false });

        expect(await service.isEnabled(RELEASE_BRAIDS, ORGANIZATION)).toBe(true);
      });
    });
  });
});
