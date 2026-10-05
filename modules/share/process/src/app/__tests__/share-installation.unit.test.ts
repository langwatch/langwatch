import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { ShareApi, ShareLinkNotFoundError } from "@langwatch/share-contract";
import { describe, expect, it } from "vitest";

import { shareProcessModule } from "../../share.module.ts";
import {
  createShareTestAuthz,
  createShareTestDataRetention,
  createShareTestProjects,
} from "./share.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role }).withModules([shareProcessModule]).withStores(memoryStores()).provide({
    authz: createShareTestAuthz(),
    "data-retention": createShareTestDataRetention(),
    project: createShareTestProjects(),
  });
}

describe("share app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

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
