import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { ShareApi, ShareLinkNotFoundError } from "@langwatch/share-contract";
import type Redis from "ioredis";
import { describe, expect, it } from "vitest";

import { shareServer } from "../../share.server.ts";
import {
  createShareTestAuthz,
  createShareTestDataRetention,
  createShareTestProjects,
} from "./share.fixture.ts";

function keyvalueWithoutStore(): Redis {
  const connection: Partial<Redis> = {};
  return new Proxy(connection, { get: () => async () => null }) as Redis;
}

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(shareServer)])
    .withKeyvalue(keyvalueWithoutStore())
    .provide({
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
