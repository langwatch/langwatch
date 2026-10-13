import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { ShareApi, ShareLinkNotFoundError } from "@langwatch/share-contract";
import { describe, expect, it } from "vitest";

import { shareProcessModule } from "../../share.module.ts";
import {
  createShareTestAuthz,
  createShareTestDataRetention,
  createShareTestProjects,
} from "./share.fixture.ts";

function process(role: "api" | "worker") {
  return bootInstalledProcess({
    role,
    modules: [shareProcessModule],
    config: {},
    stores: memoryStores(),
    peers: [
      testPeer({ token: AuthzApi, instance: createShareTestAuthz() }),
      testPeer({ token: DataRetentionApi, instance: createShareTestDataRetention() }),
      testPeer({ token: ProjectApi, instance: createShareTestProjects() }),
    ],
  });
}

describe("share app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role);

    try {
      const app = runtime.service(ShareApi);

      expect(runtime.module(shareProcessModule).provided).toBe(app);

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
