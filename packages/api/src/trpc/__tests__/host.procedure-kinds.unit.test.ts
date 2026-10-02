/**
 * What kind of procedure the host serves at a dotted path, read from the contracts it mounted:
 * the stream lane asks before it builds a caller.
 */

import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";
import { SessionReader } from "../../hosting/session-reader.ts";

interface ReviewApi {
  read(input: { id: string }): { id: string };
  archive(input: { id: string }): { archived: boolean };
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

const writes = defineTrpcRouter(
  ReviewApi,
  defineTrpcContract("review")
    .mutation("archive")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(z.object({ archived: z.boolean() }))
    .build(),
)
  .procedure("archive")
  .withPermission("annotations:update")
  .handle(({ app, input }) => app.archive(input))
  .build();

const application: ReviewApi = {
  read: ({ id }) => ({ id }),
  archive: () => ({ archived: true }),
};

function host(): TrpcHost {
  return TrpcHost.create({
    sessions: SessionReader.unverified(),
    authz: {
      getDecision: () => Promise.reject(new Error("no decision is asked here")),
      getProjectAnyDecision: () => Promise.reject(new Error("no decision is asked here")),
      checkScopeLineage: () => Promise.reject(new Error("no decision is asked here")),
    },
  });
}

describe("given a namespace mounted on the host", () => {
  describe("when the stream lane asks what a path serves", () => {
    it("answers each procedure's declared kind", () => {
      const trpc = host();
      trpc.mount(composeTrpcRouters("review", [reads, writes]), () => application);

      expect(trpc.procedureTypeAt("review.getById")).toBe("query");
      expect(trpc.procedureTypeAt("review.archive")).toBe("mutation");
    });

    it("answers nothing for a path no mounted contract declares", () => {
      const trpc = host();
      trpc.mount(composeTrpcRouters("review", [reads, writes]), () => application);

      expect(trpc.procedureTypeAt("review.delete")).toBeUndefined();
      expect(trpc.procedureTypeAt("presence.getById")).toBeUndefined();
    });
  });
});

describe("given a declaration that is not a tRPC router", () => {
  it("refuses the mount by name", () => {
    expect(() =>
      host().mount({ protocol: "rest", namespace: "review" }, () => application),
    ).toThrow(/not a tRPC router/);
  });
});
