import { type FeatureFlagApi, listFeatureFlags } from "@langwatch/feature-flag-contract";
/**
 * Operator writes reach explicit registry entries and nothing else.
 * @see specs/ops/internal-feature-flags.feature
 */
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { OpsEventingIntrospection, OpsModule, OpsCapability } from "../ops.app.ts";
import { createOpsTestApp } from "./ops.fixture.ts";

class EmptyIntrospection implements OpsEventingIntrospection {
  projections() {
    return [];
  }
  processManagers() {
    return [];
  }
  dejaViewProjections() {
    return [];
  }
}

function buildApp(): { app: OpsModule; written: string[] } {
  const written: string[] = [];
  const featureFlags = createApiFixture<FeatureFlagApi>({
    setEnabled: async ({ key }: { key: string }) => {
      written.push(key);
    },
  });

  const { app } = createOpsTestApp({
    featureFlags,
    members: {
      eventingIntrospection: new EmptyIntrospection(),
    },
  });

  return { app, written };
}

describe("given an operator writing a feature flag", () => {
  it("constructs one capability with complete peers and forwards project search", async () => {
    const searchByQuery = vi.fn<ProjectApi["searchByQuery"]>().mockResolvedValue([]);
    const createCapability = vi.fn<() => OpsCapability>(() => createApiFixture<OpsCapability>());
    const { app } = createOpsTestApp({
      projects: createApiFixture<ProjectApi>({ searchByQuery }),
      members: { createCapability, eventingIntrospection: new EmptyIntrospection() },
    });
    const query = { query: "support", organizationId: "organization-a", limit: 7 };

    expect(createCapability).toHaveBeenCalledOnce();
    expect(await app.searchProjects(query)).toEqual([]);
    expect(searchByQuery).toHaveBeenCalledExactlyOnceWith(query);
  });

  describe("when the key is a registered flag", () => {
    it("stores the value", async () => {
      const { app, written } = buildApp();
      const [flag] = listFeatureFlags();

      await app.setFeatureFlagEnabled({
        key: flag!.key,
        enabled: true,
        lastEditedBy: "operator-1",
      });

      expect(written).toEqual([flag!.key]);
    });
  });

  describe("when the key is a generated event-sourcing kill switch", () => {
    it("refuses the write because no component reads it", async () => {
      const { app, written } = buildApp();

      await expect(
        app.setFeatureFlagEnabled({
          key: "es-trace-subscriber-typoTrigger-killswitch",
          enabled: true,
          lastEditedBy: "operator-1",
        }),
      ).rejects.toMatchObject({ code: "ops_feature_flag_unknown" });
      expect(written).toEqual([]);
    });
  });
});
