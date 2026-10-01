/**
 * One request asks each authorization question once; the next request asks again.
 * @see specs/identity/auth-read-caching.feature
 */

import { createApiFixture } from "@langwatch/api-fixture";
import type { PermissionDecision } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/kernel";
import { defineTrpcContract } from "@langwatch/kernel/contract";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Authorize } from "../../access/access.ts";
import { SessionReader } from "../../rest/credential.ts";
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
  const authz = createApiFixture<Authorize>({
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

  const batch = async (ids: readonly string[]) => {
    const request = new Request(
      `http://api.test${TrpcHost.path}/${ids.map(() => "review.getById").join(",")}?batch=1&input=${encodeURIComponent(
        JSON.stringify(
          Object.fromEntries(ids.map((id, index) => [index, { projectId: "p1", id }])),
        ),
      )}`,
    );
    let context: ReturnType<TrpcHost["context"]> | undefined;
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => (context ??= trpc.context({ request })),
    });

    return (await response.json()) as { result?: unknown; error?: unknown }[];
  };

  return {
    batch,
    decisions,
    lineages,
    revoke: () => {
      permitted = false;
    },
  };
}

describe("given a batched request whose procedures need the same permission on one project", () => {
  /** @scenario "A batch asking the same permission decides it once" */
  it("asks authorization once for the whole batch", async () => {
    const { batch, decisions, lineages } = served();

    const answers = await batch(["a", "b", "c"]);

    expect(answers.every((answer) => answer.result !== undefined)).toBe(true);
    expect(decisions).toHaveBeenCalledTimes(1);
    expect(lineages).toHaveBeenCalledTimes(1);
  });
});

describe("given one request was allowed", () => {
  describe("when the permission is removed before the next request", () => {
    /** @scenario "Two requests never share a decision" */
    it("refuses the next request", async () => {
      const { batch, decisions, revoke } = served();
      const [allowed] = await batch(["a"]);
      expect(allowed?.result).toBeDefined();

      revoke();
      const [refused] = await batch(["a"]);

      expect(refused?.error).toBeDefined();
      expect(decisions).toHaveBeenCalledTimes(2);
    });
  });
});
