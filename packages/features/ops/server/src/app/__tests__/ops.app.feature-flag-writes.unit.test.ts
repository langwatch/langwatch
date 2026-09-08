/**
 * Operator writes reach explicit registry entries and the kill switches the
 * live pipeline graph advertises, and nothing else.
 * @see specs/ops/internal-feature-flags.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import {
  OpsEventingIntrospectionPort,
  type OpsKillSwitchDescriptor,
} from "../../ports/eventing-introspection.port.ts";
import { OpsApp, type OpsCapability } from "../ops.app.ts";

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

  return {
    app: OpsApp.create({
      infrastructure: {
        createCapability: () => createApiFixture<OpsCapability>(),
        featureFlags,
        eventingIntrospection: new OneSwitchIntrospection(),
      },
      dependencies: {
        users: createApiFixture<UserApi>(),
        auth: createApiFixture<AuthApi>(),
        projects: createApiFixture<ProjectApi>({ searchByQuery: async () => [] }),
        auditLog: createApiFixture<AuditLogApi>(),
      },
      config: undefined,
      resources: new ResourceScope(),
    }),
    written,
  };
}

describe("given an operator writing a feature flag", () => {
  it("constructs one capability with complete peers and forwards project search", async () => {
    const searchByQuery = vi.fn<ProjectApi["searchByQuery"]>().mockResolvedValue([]);
    const dependencies = {
      users: createApiFixture<UserApi>(),
      auth: createApiFixture<AuthApi>(),
      projects: createApiFixture<ProjectApi>({ searchByQuery }),
      auditLog: createApiFixture<AuditLogApi>(),
    };
    const createCapability = vi.fn<() => OpsCapability>(() => createApiFixture<OpsCapability>());
    const app = OpsApp.create({
      dependencies,
      infrastructure: {
        createCapability,
        featureFlags: createApiFixture<FeatureFlagApi>(),
        eventingIntrospection: new OneSwitchIntrospection(),
      },
      config: void 0,
      resources: new ResourceScope(),
    });
    const query = { query: "support", organizationId: "organization-a", limit: 7 };

    expect(createCapability).toHaveBeenCalledExactlyOnceWith(dependencies);
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
