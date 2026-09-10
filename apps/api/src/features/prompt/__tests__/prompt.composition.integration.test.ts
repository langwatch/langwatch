/**
 * @vitest-environment node
 *
 * The prompt library, installed and booted the way the API process boots it.
 * This proves the install itself completes - the module, its transports and
 * its peer wiring resolve through `createApp(...).withModule(...).boot(...)` -
 * not a full read/write round trip over a real database.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { installApiPrompt } from "../prompt.composition.ts";

/** Nothing this boot reads is queried before a request arrives. */
function memoryPrisma(): PrismaClient {
  return {} as unknown as PrismaClient;
}

function testProjects(): ProjectApi {
  return {
    getOrganizationId: vi.fn(async () => "organization-1"),
    listIdsByOrganization: vi.fn(async () => ["project-1"]),
  } as unknown as ProjectApi;
}

function testPermissions(): AuthzApi {
  return {
    hasPermission: vi.fn(async () => true),
    getApiKeyProjectDecision: vi.fn(async () => ({ outcome: "allowed" as const })),
  } as unknown as AuthzApi;
}

async function install() {
  return installApiPrompt({
    infrastructure: { prisma: memoryPrisma() } as never,
    peers: { projects: testProjects(), permissions: testPermissions() },
  });
}

describe("given the API process installs the prompt library", () => {
  describe("when it boots", () => {
    it("answers the installed application's own methods", async () => {
      const feature = await install();

      expect(typeof feature.app.listForProject).toBe("function");
      expect(typeof feature.app.seedTagsForOrganization).toBe("function");
    });

    it("mounts both declared tRPC namespaces", async () => {
      const feature = await install();
      const runtime = {
        mount: vi.fn((_transport: unknown, _resolve: unknown) => ({ mounted: true })),
      };

      const routers = feature.routers({ runtime } as never);

      expect(routers.prompts).toEqual({ mounted: true });
      expect(routers.promptTags).toEqual({ mounted: true });
      expect(runtime.mount).toHaveBeenCalledTimes(2);
    });

    it("mounts the /api/prompts REST family", async () => {
      const feature = await install();
      const runtime = { mount: vi.fn(() => ({ mounted: true })) };

      const rest = feature.rest(runtime as never);

      expect(rest).toEqual({ mounted: true });
      expect(runtime.mount).toHaveBeenCalledTimes(1);
    });
  });
});
