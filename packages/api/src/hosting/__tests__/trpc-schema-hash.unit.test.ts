/**
 * Every tRPC query answers with its schema hash; a batched request is refused.
 * Spec: specs/ui/browser-query-caching.feature.
 */

import { createApiFixture } from "@langwatch/api-fixture";
import { moduleApi } from "@langwatch/kernel";
import { defineTrpcContract, schemaHashesOf } from "@langwatch/kernel/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Authorize } from "../../access/access.ts";
import { SessionReader } from "../../rest/credential.ts";
import { composeTrpcRouters } from "../../trpc/compose.ts";
import { TrpcHost } from "../../trpc/host.ts";
import { defineTrpcRouter } from "../../trpc/runtime.ts";
import { composeApiApplication } from "../api-application.ts";

interface ProfileApi {
  motto(): { motto: string };
  rename(): { renamed: boolean };
}

const ProfileApi = moduleApi<ProfileApi>()("annotation");

const profileTrpc = defineTrpcContract("profile")
  .query("live", { revision: 2 })
  .withInput(z.object({}))
  .withOutput(z.object({ motto: z.string() }))
  .mutation("rename")
  .withInput(z.object({}))
  .withOutput(z.object({ renamed: z.boolean() }))
  .build();

const reason = "a test namespace; no permission applies";
const router = defineTrpcRouter(ProfileApi, profileTrpc)
  .procedure("live")
  .noPermission({ reason })
  .handle(({ app }) => app.motto())
  .procedure("rename")
  .noPermission({ reason })
  .handle(({ app }) => app.rename())
  .build();

const input = encodeURIComponent("{}");

describe("given a tRPC surface mounting a contract", () => {
  let app: ReturnType<typeof composeApiApplication>;

  beforeEach(() => {
    const trpc = TrpcHost.create({
      sessions: SessionReader.create({ verify: async () => ({ userId: "user_ada" }) }),
      authz: createApiFixture<Authorize>({
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    });
    const application: ProfileApi = {
      motto: () => ({ motto: "trust until told" }),
      rename: () => ({ renamed: true }),
    };
    trpc.mount(composeTrpcRouters("profile", [router]), () => application);
    app = composeApiApplication({ trpc });
  });

  describe("when a query and a mutation answer", () => {
    /** @scenario "Every tRPC query answer carries its schema hash" */
    it("stamps the query with the hash the contract gives, and the mutation with none", async () => {
      const read = await app.request(`/api/trpc/profile.live?input=${input}`);
      const write = await app.request("/api/trpc/profile.rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      expect(read.status).toBe(200);
      expect(read.headers.get("x-lw-schema")).toBe(schemaHashesOf(profileTrpc)["profile.live"]);
      expect(write.status).toBe(200);
      expect(write.headers.get("x-lw-schema")).toBeNull();
    });
  });

  describe("when a request is batched", () => {
    /** @scenario "A batched tRPC request is refused" */
    it("refuses it with a 400 batching_not_supported", async () => {
      const response = await app.request(
        `/api/trpc/profile.live,profile.live?batch=1&input=${encodeURIComponent('{"0":{},"1":{}}')}`,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "batching_not_supported" });
    });
  });
});
