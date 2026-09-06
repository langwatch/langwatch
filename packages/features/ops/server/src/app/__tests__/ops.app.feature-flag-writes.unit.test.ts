/**
 * Operator writes reach explicit registry entries and the kill switches the
 * live pipeline graph advertises, and nothing else.
 * @see specs/ops/internal-feature-flags.feature
 */
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";
import {
  OpsEventingIntrospectionPort,
  type OpsKillSwitchDescriptor,
} from "../../ports/eventing-introspection.port";
import { OpsApp, type OpsCapability } from "../ops.app";

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
  const featureFlags = {
    setEnabled: async ({ key }: { key: string }) => {
      written.push(key);
    },
  } as unknown as FeatureFlagService;

  return {
    app: OpsApp.create({
      ops: {} as OpsCapability,
      featureFlags,
      projects: { searchByQuery: async () => [] },
      eventingIntrospection: new OneSwitchIntrospection(),
    }),
    written,
  };
}

describe("given an operator writing a feature flag", () => {
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
