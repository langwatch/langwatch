/**
 * One request asks each authorization question once; the next request asks again.
 * @see specs/identity/auth-read-caching.feature
 */

import type { PermissionDecision } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

interface ReviewApi {
  read(input: { id: string }): { id: string };
}

const ReviewApi = moduleApi<ReviewApi>()("annotation");

const reads = defineTrpcRouter(
  ReviewApi,
  defineTrpcContract("review")
    .query("getById")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(z.object({ id: z.string() }))
    .build(),
)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.read(input))
  .build();

function served() {
  let permitted = true;
  const authz = createApiDouble<Authorize>({
    getDecision: async (): Promise<PermissionDecision> => ({
      permitted,
      organizationRole: "MEMBER",
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  });
  const decisions = vi.spyOn(authz, "getDecision");
  const lineages = vi.spyOn(authz, "checkScopeLineage");
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz,
  });
  const application: ReviewApi = { read: ({ id }) => ({ id }) };
  trpc.mount(composeTrpcRouters("review", [reads]), () => application);

  const call = async (id: string) => {
    const request = new Request(
      `http://api.test${TrpcHost.path}/review.getById?input=${encodeURIComponent(
        JSON.stringify({ projectId: "p1", id }),
      )}`,
    );
    let context: ReturnType<TrpcHost["context"]> | undefined;
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => (context ??= trpc.context({ request })),
    });

    return (await response.json()) as { result?: unknown; error?: unknown };
  };

  return {
    call,
    decisions,
    lineages,
    revoke: () => {
      permitted = false;
    },
  };
}

describe("given a request whose procedure needs a permission on one project", () => {
  /** @scenario "A request decides its permission once" */
  it("asks authorization once", async () => {
    const { call, decisions, lineages } = served();

    const answer = await call("a");

    expect(answer.result).toBeDefined();
    expect(decisions).toHaveBeenCalledTimes(1);
    expect(lineages).toHaveBeenCalledTimes(1);
  });
});

describe("given one request was allowed", () => {
  describe("when the permission is removed before the next request", () => {
    /** @scenario "Two requests never share a decision" */
    it("refuses the next request", async () => {
      const { call, decisions, revoke } = served();
      const allowed = await call("a");
      expect(allowed.result).toBeDefined();

      revoke();
      const refused = await call("a");

      expect(refused.error).toBeDefined();
      expect(decisions).toHaveBeenCalledTimes(2);
    });
  });
});

interface QueueApi {
  listQueues(input: unknown): { queues: string[] };
}

const QueueApi = moduleApi<QueueApi>()("ops");

const platformReads = defineTrpcRouter(
  QueueApi,
  defineTrpcContract("queues")
    .query("listQueues")
    .withInput(z.object({}))
    .withOutput(z.object({ queues: z.array(z.string()) }))
    .build(),
)
  .procedure("listQueues")
  .withPermission("ops:view", { at: "platform" })
  .handle(({ app, input }) => app.listQueues(input))
  .build();

describe("given a procedure that asks a platform-tier permission", () => {
  it("hands the platform question to the host's authorization, once per request", async () => {
    const authz = createApiDouble<Authorize>({
      getPlatformDecision: async () => ({ permitted: true }),
    });
    const platform = vi.spyOn(authz, "getPlatformDecision");
    const trpc = TrpcHost.create({
      sessions: SessionReader.create({ verify: async () => ({ userId: "operator-1" }) }),
      authz,
    });
    trpc.mount(composeTrpcRouters("queues", [platformReads]), () => ({
      listQueues: () => ({ queues: ["collector"] }),
    }));
    const request = new Request(
      `http://api.test${TrpcHost.path}/queues.listQueues?input=${encodeURIComponent("{}")}`,
    );

    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => trpc.context({ request }),
    });

    expect(((await response.json()) as { result?: unknown }).result).toBeDefined();
    expect(platform).toHaveBeenCalledTimes(1);
  });
});
