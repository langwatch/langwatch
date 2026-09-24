/**
 * Composing several built routers into one namespace claim: what reaches the
 * mount, what the merged surface serves, and what composition refuses where
 * both fragments are still in view.
 */

import { moduleApi } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTrpcContract } from "../../contract/trpc-contract.ts";
import { composeTrpcRouters, type ComposableTrpcRouter } from "../compose.ts";
import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcProcedureFactory,
  type TrpcProcedureRequest,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

interface ReviewApi {
  read(input: { id: string }): { id: string };
  archive(input: { id: string }): { archived: boolean };
}

const ReviewApi = moduleApi<ReviewApi>()("annotation");
const PresenceApi = moduleApi<ReviewApi>()("presence");

const readsContract = defineTrpcContract("review")
  .query("getById")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .withOutput(z.object({ id: z.string() }))
  .build();

const writesContract = defineTrpcContract("review")
  .mutation("archive")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .withOutput(z.object({ archived: z.boolean() }))
  .build();

const clashingContract = defineTrpcContract("review")
  .mutation("getById")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .withOutput(z.object({ id: z.string() }))
  .build();

const otherNamespaceContract = defineTrpcContract("presence")
  .query("getById")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .withOutput(z.object({ id: z.string() }))
  .build();

const reads = defineTrpcRouter(ReviewApi, readsContract)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.read(input))
  .build();

const writes = defineTrpcRouter(ReviewApi, writesContract)
  .procedure("archive")
  .withPermission("annotations:update")
  .handle(({ app, input }) => app.archive(input))
  .build();

const clashing = defineTrpcRouter(ReviewApi, clashingContract)
  .procedure("getById")
  .withPermission("annotations:update")
  .handle(({ app, input }) => app.read(input))
  .build();

const otherNamespace = defineTrpcRouter(ReviewApi, otherNamespaceContract)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.read(input))
  .build();

const otherApplication = defineTrpcRouter(PresenceApi, writesContract)
  .procedure("archive")
  .withPermission("annotations:update")
  .handle(({ app, input }) => app.archive(input))
  .build();

/** A stand-in root that answers each built procedure with its own request. */
function collectingRuntime(): TrpcProcedureFactory<object> & {
  readonly built: Record<string, TrpcProcedureRequest<object>>;
} {
  const built: Record<string, TrpcProcedureRequest<object>> = {};

  return {
    built,
    procedure: (request) => {
      built[request.procedure] = request;

      return request;
    },
    router: (record) => ({ record }),
  };
}

const application: ReviewApi = {
  read: ({ id }) => ({ id }),
  archive: () => ({ archived: true }),
};

describe("given two routers built under one namespace", () => {
  const composed = composeTrpcRouters("review", [reads, writes]);

  it("claims the namespace once, for the application both routers serve", () => {
    expect(composed.protocol).toBe("trpc");
    expect(composed.namespace).toBe("review");
    expect(composed.api).toBe(ReviewApi);
  });

  it("declares every procedure both routers declared", () => {
    expect(Object.keys(composed.contract.members).toSorted()).toEqual(["archive", "getById"]);
    expect(composed.contract.members.getById?.kind).toBe("query");
    expect(composed.contract.members.archive?.kind).toBe("mutation");
  });

  describe("when the process mounts it", () => {
    it("builds both routers' procedures on the one runtime it was handed", () => {
      const runtime = collectingRuntime();

      const mounted = composed.router(runtime, () => application) as unknown as {
        record: Record<string, unknown>;
      };

      expect(Object.keys(runtime.built).toSorted()).toEqual(["review.archive", "review.getById"]);
      expect(Object.keys(mounted.record).toSorted()).toEqual(["archive", "getById"]);
    });

    it("keeps each procedure's own access declaration and handler", () => {
      const runtime = collectingRuntime();
      composed.router(runtime, () => application);

      const read = runtime.built["review.getById"];
      const archive = runtime.built["review.archive"];

      expect(read?.access).toEqual({ kind: "permission", permission: "annotations:view" });
      expect(archive?.access).toEqual({ kind: "permission", permission: "annotations:update" });

      const handle = archive?.handle as unknown as (args: {
        app: ReviewApi;
        input: { id: string };
      }) => unknown;

      expect(handle({ app: application, input: { id: "review-1" } })).toEqual({ archived: true });
    });

    /** @scenario "A namespace too large for one declaration is claimed once" */
    it("answers one router of the process's own root, with both procedure sets on it", () => {
      const root = TrpcRootDefinition.forContext<object>().create();

      const runtime = createTrpcRuntime({
        root,
        procedure: root.procedure,
        members: unusedPorts(),
      });

      const mounted = runtime.mount(composed, () => application);

      expect(Object.keys(mounted._def.procedures).toSorted()).toEqual(["archive", "getById"]);
    });
  });
});

describe("given two routers that declare the same procedure", () => {
  /** @scenario "Two routers that declare the same procedure are refused" */
  it("refuses the composition, naming the procedure", () => {
    expect(() => composeTrpcRouters("review", [reads, clashing])).toThrow(
      /both declare procedure "getById"/,
    );
  });
});

describe("given a router declared under another namespace", () => {
  it("refuses the composition, naming the namespace it came from", () => {
    // The type refuses it too; the cast is what lets the test prove the
    // runtime refusal a `namespace` read off a value would still need.
    const foreign = otherNamespace as unknown as ComposableTrpcRouter<"review">;

    expect(() => composeTrpcRouters("review", [reads, foreign])).toThrow(
      /declared under "presence"/,
    );
  });
});

describe("given routers that serve two different applications", () => {
  it("refuses the composition", () => {
    expect(() => composeTrpcRouters("review", [reads, otherApplication])).toThrow(
      /two different applications/,
    );
  });
});

describe("given no routers at all", () => {
  it("refuses the composition rather than claiming an empty namespace", () => {
    expect(() => composeTrpcRouters("review", [])).toThrow(/composed from no routers at all/);
  });
});

/** Ports the mount never reaches: building a procedure asks none of them. */
function unusedPorts(): TrpcRuntimeMembers<object> {
  const unreachable = () => {
    throw new Error("mounting a composed router asked the process for a request's members");
  };

  return {
    identity: { caller: unreachable },
    authorization: { forRequest: unreachable },
    denials: { membershipDisabled: unreachable, liteMemberRestricted: unreachable },
    audit: { record: unreachable, redact: unreachable, exempt: unreachable },
    errors: { report: unreachable, asError: unreachable, translate: unreachable },
  };
}
