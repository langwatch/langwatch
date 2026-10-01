import { FeatureFlagApi, UnknownFeatureFlagError } from "@langwatch/feature-flag-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";

import { featureFlagServer } from "../../feature-flag.server.ts";
import {
  createFeatureFlagTestAuthz,
  createFeatureFlagTestProjects,
  TestOrganizations,
} from "./feature-flag.fixture.ts";

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(featureFlagServer)])
    .withConfig({ "feature-flag": { forceEnable: [], overrides: {}, legacy: {} } })
    .provide({
      authz: createFeatureFlagTestAuthz(),
      project: createFeatureFlagTestProjects(),
      organization: TestOrganizations.create().api(),
    });
}

describe("feature flag app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(FeatureFlagApi);

      expect(runtime.module(featureFlagServer).provided).toBe(app);

      await expect(app.isEnabled(SYSTEM_FLAG, { kind: "system" })).resolves.toBe(false);

      await app.setEnabled({ key: SYSTEM_FLAG, enabled: true, lastEditedBy: "operator-1" });

      await expect(app.isEnabled(SYSTEM_FLAG, { kind: "system" })).resolves.toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

    try {
      await first
        .service(FeatureFlagApi)
        .setEnabled({ key: SYSTEM_FLAG, enabled: true, lastEditedBy: "operator-1" });

      await expect(
        first.service(FeatureFlagApi).isEnabled(SYSTEM_FLAG, { kind: "system" }),
      ).resolves.toBe(true);
      await expect(
        second.service(FeatureFlagApi).isEnabled(SYSTEM_FLAG, { kind: "system" }),
      ).resolves.toBe(false);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  it("refuses a key the registry does not define", async () => {
    const runtime = await process("api").boot();

    try {
      await expect(
        runtime
          .service(FeatureFlagApi)
          .setEnabled({ key: "not_a_flag", enabled: true, lastEditedBy: "operator-1" }),
      ).rejects.toBeInstanceOf(UnknownFeatureFlagError);
    } finally {
      await runtime.stop();
    }
  });
});
