/**
 * Operator writes reach explicit registry entries and the kill switches the
 * live pipeline graph advertises, and nothing else.
 * @see specs/ops/internal-feature-flags.feature
 */
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { describe, expect, it, vi } from "vitest";
import {
  OpsEventingIntrospectionPort,
  type OpsKillSwitchDescriptor,
} from "../../ports/eventing-introspection.port.ts";
import type { OpsApp, OpsCapability } from "../ops.app.ts";
import { createOpsTestApp } from "./ops.fixture.ts";

const liveSwitch: OpsKillSwitchDescriptor = {
  key: "es-trace-subscriber-evaluationTrigger-killswitch",
  aggregateType: "trace",
  componentType: "subscriber",
  componentName: "evaluationTrigger",
  pipelineName: "trace-processing",
};

class OneSwitchIntrospection extends OpsEventingIntrospectionPort {
  projections() {
    return [];
  }
  killSwitches(): OpsKillSwitchDescriptor[] {
    return [liveSwitch];
  }
  processManagers() {
    return [];
  }
  dejaViewProjections() {
    return [];
  }
}

function buildApp(): { app: OpsApp; written: string[] } {
  const written: string[] = [];
  const featureFlags = createApiFixture<FeatureFlagApi>({
    setEnabled: async ({ key }: { key: string }) => {
      written.push(key);
    },
  });

  const { app } = createOpsTestApp({
    infrastructure: {
      featureFlags,
      eventingIntrospection: new OneSwitchIntrospection(),
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
      infrastructure: { createCapability, eventingIntrospection: new OneSwitchIntrospection() },
    });
    const query = { query: "support", organizationId: "organization-a", limit: 7 };

    expect(createCapability).toHaveBeenCalledOnce();
    expect(await app.searchProjects(query)).toEqual([]);
    expect(searchByQuery).toHaveBeenCalledExactlyOnceWith(query);
  });

  describe("when the key is a kill switch the live pipelines will read", () => {
    it("stores the value", async () => {
      const { app, written } = buildApp();

      await app.setFeatureFlagEnabled({
        key: liveSwitch.key,
        enabled: true,
        lastEditedBy: "operator-1",
      });

      expect(written).toEqual([liveSwitch.key]);
    });
  });

  describe("when the key only looks like one", () => {
    it("refuses the write rather than storing an orphan row", async () => {
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
