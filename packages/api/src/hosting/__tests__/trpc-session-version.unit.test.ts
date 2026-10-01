/**
 * The session version on every tRPC answer (dev/docs/adr/164-browser-query-cache-tiers.md).
 * Spec: specs/ui/browser-query-caching.feature.
 */

import { createApiFixture } from "@langwatch/api-fixture";
import { moduleApi } from "@langwatch/kernel";
import { defineTrpcContract } from "@langwatch/kernel/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Authorize } from "../../access/access.ts";
import { SessionReader } from "../../rest/credential.ts";
import { composeTrpcRouters } from "../../trpc/compose.ts";
import { TrpcHost } from "../../trpc/host.ts";
import { defineTrpcRouter } from "../../trpc/runtime.ts";
import type { TrpcSessionVersions } from "../../trpc/session-version.ts";
import { composeApiApplication } from "../api-application.ts";

interface ProfileApi {
  own(input: { userId: string }): { name: string };
  motto(): { motto: string };
  rename(): { renamed: boolean };
}

const ProfileApi = moduleApi<ProfileApi>()("annotation");

const profileTrpc = defineTrpcContract("profile")
  .query("own")
  .withInput(z.object({}))
  .withOutput(z.object({ name: z.string() }))
  .query("live")
  .withInput(z.object({}))
  .withOutput(z.object({ motto: z.string() }))
  .mutation("rename")
  .withInput(z.object({}))
  .withOutput(z.object({ renamed: z.boolean() }))
  .build();

const reason = "a test namespace; no permission applies";
const router = defineTrpcRouter(ProfileApi, profileTrpc)
  .procedure("own")
  .noPermission({ reason })
  .handle(({ app, actor }) => app.own({ userId: actor.id }))
  .procedure("live")
  .noPermission({ reason })
  .handle(({ app }) => app.motto())
  .procedure("rename")
  .noPermission({ reason })
  .handle(({ app }) => app.rename())
  .build();

const query = (path: string) => `/api/trpc/${path}?input=${encodeURIComponent("{}")}`;
const OWN = query("profile.own");

describe("given a tRPC surface reading session versions from authz", () => {
  let names: Map<string, string>;
  let app: ReturnType<typeof composeApiApplication>;

  beforeEach(() => {
    names = new Map([
      ["user_ada", "Ada"],
      ["user_bo", "Bo"],
    ]);
    const authz = createApiFixture<Authorize & TrpcSessionVersions>({
      getSessionVersion: async () => 7,
      checkScopeLineage: async () => ({ kind: "consistent" }),
    });
    const trpc = TrpcHost.create({
      sessions: SessionReader.create({
        verify: async (request) => {
          const userId = request.headers.get("x-test-user");
          return userId ? { userId } : null;
        },
      }),
      authz,
      sessionVersions: authz,
    });
    const application: ProfileApi = {
      own: ({ userId }) => ({ name: names.get(userId) ?? "" }),
      motto: () => ({ motto: "trust until told" }),
      rename: () => ({ renamed: true }),
    };
    trpc.mount(composeTrpcRouters("profile", [router]), () => application);
    app = composeApiApplication({ trpc });
  });

  const ask = (path: string, user: string, init: { method?: string } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: {
        "x-test-user": user,
        "content-type": "application/json",
      },
      ...(init.method === "POST" ? { body: "{}" } : {}),
    });

  describe("when any procedure answers a signed-in caller", () => {
    /** @scenario "Every tRPC answer carries the session version" */
    it("carries the caller's session version on reads and writes alike", async () => {
      const read = await ask(query("profile.live"), "user_ada");
      const write = await ask("/api/trpc/profile.rename", "user_ada", { method: "POST" });

      expect(read.headers.get("x-lw-session-version")).toBe("7");
      expect(write.status).toBe(200);
      expect(write.headers.get("x-lw-session-version")).toBe("7");
    });
  });

  describe("when the caller is anonymous", () => {
    it("carries no version", async () => {
      const response = await app.request(OWN);

      expect(response.headers.get("x-lw-session-version")).toBeNull();
    });
  });
});
