import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { ShareApi, ShareLinkNotFoundError } from "@langwatch/share-contract";
import { describe, expect, it } from "vitest";
import { shareServer } from "../../share.server.ts";
import {
  createShareTestAuthz,
  createShareTestDataRetention,
  createShareTestProjects,
} from "./share.fixture.ts";

function process() {
  return createApp({ name: "share-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(AuthzApi, createShareTestAuthz())
    .withProvided(DataRetentionApi, createShareTestDataRetention())
    .withProvided(ProjectApi, createShareTestProjects())
    .withModule(shareServer, { infrastructure: { redis: null } });
}

describe("share app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

    try {
      const app = runtime.service(ShareApi);

      expect(runtime.module(shareServer).provided).toBe(app);

      await expect(
        app.resolveForViewer({ token: "tok_missing", viewer: { type: "anonymous" } }),
      ).rejects.toBeInstanceOf(ShareLinkNotFoundError);

      await expect(
        app.listForResource({
          projectId: "project-1",
          resourceType: "TRACE",
          resourceId: "trace-1",
        }),
      ).resolves.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });
});
