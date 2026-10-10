/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import type { PermissionDecision } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Authorize } from "../access/access.ts";
import { SessionReader } from "../hosting/session-reader.ts";
import { canonicalErrorResponse, withRetryAfter } from "../rest/response.ts";
import { composeTrpcRouters } from "../trpc/compose.ts";
import { TrpcHost } from "../trpc/host.ts";
import { defineTrpcRouter } from "../trpc/runtime.ts";
import { SseLane } from "../trpc/sse.ts";
import { createApiDouble } from "./api-double.ts";

const schemaBehind = (code: string) =>
  Object.assign(new Error("The table `public.NewThing` does not exist"), { code });

async function restAnswerFor(failure: unknown): Promise<Response> {
  const app = new Hono();
  app.get("/read", () => {
    throw failure;
  });
  app.onError(withRetryAfter((error, c) => canonicalErrorResponse(error, c)));
  return app.request("/read");
}

interface ThingApi {
  read(input: { id: string }): { id: string };
}

const ThingApi = moduleApi<ThingApi>()("annotation");

const thingReads = defineTrpcRouter(
  ThingApi,
  defineTrpcContract("things")
    .query("read")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(z.object({ id: z.string() }))
    .build(),
)
  .procedure("read")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.read(input))
  .build();

async function trpcAnswerFor(failure: unknown): Promise<Response> {
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz: createApiDouble<Authorize>({
      getDecision: async (): Promise<PermissionDecision> => ({
        permitted: true,
        organizationRole: "MEMBER",
      }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
      organizationOf: async () => null,
      projectKindOf: async () => "application",
    }),
  });
  trpc.mount(composeTrpcRouters("things", [thingReads]), () => ({
    read: () => {
      throw failure;
    },
  }));
  const input = encodeURIComponent(JSON.stringify({ projectId: "p1", id: "t1" }));
  const request = new Request(`http://api.test${TrpcHost.path}/things.read?input=${input}`);

  return fetchRequestHandler({
    endpoint: TrpcHost.path,
    req: request,
    router: trpc.router,
    createContext: () => trpc.context({ request }),
    allowBatching: false,
    responseMeta: ({ errors }) => ({ headers: trpc.retryAfterHeaders({ errors }) }),
  });
}

describe("a Postgres read the schema is not ready for", () => {
  describe("when a REST handler's query names a table or column a pending step adds", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it.each(["P2021", "P2022", "42P01", "42703"])(
      "answers %s as 503 upgrade_in_progress with Retry-After",
      async (code) => {
        const response = await restAnswerFor(schemaBehind(code));

        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("10");
        expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
      },
    );
  });

  describe("when a tRPC query's does", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it("answers 503 upgrade_in_progress with the same Retry-After as REST", async () => {
      const response = await trpcAnswerFor(schemaBehind("P2022"));

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("10");
      expect(await response.text()).toContain('"message":"upgrade_in_progress"');
    });
  });

  describe("when a live subscription's query does", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it("ends the stream with the handled upgrade_in_progress frame", async () => {
      const lane = SseLane.create({
        members: {
          createCaller: async () => ({
            traces: {
              watch: async () => {
                throw schemaBehind("P2022");
              },
            },
          }),
          procedureTypeAt: () => "subscription",
        },
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      });

      const response = await lane.answer(
        new Request("http://api.test/api/sse/traces/watch", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
        new Headers(),
      );

      expect(await response.text()).toContain('"message":"upgrade_in_progress"');
    });
  });
});
