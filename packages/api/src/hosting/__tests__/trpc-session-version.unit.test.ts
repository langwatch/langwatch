/**
 * The session version on every tRPC answer, and the content ETag a session or
 * reference read revalidates by (dev/docs/adr/164-browser-query-cache-tiers.md).
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
  .query("own", { cache: { tier: "session" } })
  .withInput(z.object({}))
  .withOutput(z.object({ name: z.string() }))
  .query("motto", { cache: { tier: "reference" } })
  .withInput(z.object({}))
  .withOutput(z.object({ motto: z.string() }))
  .query("live", { cache: { tier: "live" } })
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
  .procedure("motto")
  .noPermission({ reason })
  .handle(({ app }) => app.motto())
  .procedure("live")
  .noPermission({ reason })
  .handle(({ app }) => app.motto())
  .procedure("rename")
  .noPermission({ reason })
  .handle(({ app }) => app.rename())
  .build();

const answerSchema = z.object({ result: z.object({ data: z.object({ name: z.string() }) }) });
const query = (path: string) => `/api/trpc/${path}?input=${encodeURIComponent("{}")}`;
const OWN = query("profile.own");
const MOTTO = query("profile.motto");

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

  const ask = (path: string, user: string, init: { etag?: string | null; method?: string } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: {
        "x-test-user": user,
        "content-type": "application/json",
        ...(init.etag ? { "if-none-match": init.etag } : {}),
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

  describe("when a session read is asked again with its ETag", () => {
    /** @scenario "A session read answers 304 when its body is unchanged" */
    it("answers 304 with no body while the body is unchanged", async () => {
      const first = await ask(OWN, "user_ada");
      expect(first.status).toBe(200);
      expect(first.headers.get("etag")).toMatch(/^"user_ada\./);
      expect(first.headers.get("cache-control")).toBe("private, no-cache");
      expect(first.headers.get("vary")).toBe("Cookie");

      const again = await ask(OWN, "user_ada", { etag: first.headers.get("etag") });

      expect(again.status).toBe(304);
      expect(await again.text()).toBe("");
      expect(again.headers.get("etag")).toBe(first.headers.get("etag"));
      expect(again.headers.get("x-lw-session-version")).toBe("7");
    });

    /** @scenario "A changed body gets a new ETag" */
    it("answers 200 with the new body and a new tag once the body changed", async () => {
      const first = await ask(OWN, "user_ada");
      names.set("user_ada", "Ada Lovelace");

      const again = await ask(OWN, "user_ada", { etag: first.headers.get("etag") });

      expect(again.status).toBe(200);
      expect(again.headers.get("etag")).not.toBe(first.headers.get("etag"));
      expect(answerSchema.parse(await again.json()).result.data.name).toBe("Ada Lovelace");
    });

    /** @scenario "One user's ETag never revalidates another user's read" */
    it("answers another user in full, even for a byte-identical body", async () => {
      const first = await ask(MOTTO, "user_ada");

      const other = await ask(MOTTO, "user_bo", { etag: first.headers.get("etag") });

      expect(other.status).toBe(200);
      expect(other.headers.get("etag")).toMatch(/^"user_bo\./);
    });
  });

  describe("when a read outside the session and reference tiers is asked again", () => {
    /** @scenario "A live read or a batch never carries an ETag" */
    it("answers in full and carries no tag", async () => {
      const live = await ask(query("profile.live"), "user_ada");
      const batch = await app.request(
        `/api/trpc/profile.own,profile.motto?batch=1&input=${encodeURIComponent('{"0":{},"1":{}}')}`,
        { headers: { "x-test-user": "user_ada" } },
      );

      expect(live.headers.get("etag")).toBeNull();
      expect(batch.headers.get("etag")).toBeNull();
    });
  });

  describe("when the caller is anonymous", () => {
    it("carries no version and never answers 304", async () => {
      const response = await app.request(OWN, { headers: { "if-none-match": "*" } });

      expect(response.status).not.toBe(304);
      expect(response.headers.get("x-lw-session-version")).toBeNull();
    });
  });
});
