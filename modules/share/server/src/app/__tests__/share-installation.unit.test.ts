import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp, membersFrom, withMemoryRepositories } from "@langwatch/runtime-composition";
import { ShareApi, ShareLinkNotFoundError } from "@langwatch/share-contract";
import { describe, expect, it } from "vitest";
import { shareServer } from "../../share.server.ts";
import {
  createShareTestAuthz,
  createShareTestDataRetention,
  createShareTestProjects,
  createShareTestRedis,
} from "./share.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({
    role,
    config: {},
    members: membersFrom({ redis: createShareTestRedis() }),
  })
    .withProvided(AuthzApi, createShareTestAuthz())
    .withProvided(DataRetentionApi, createShareTestDataRetention())
    .withProvided(ProjectApi, createShareTestProjects())
    .withModules([withMemoryRepositories(shareServer)]);
}

describe("share app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

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
