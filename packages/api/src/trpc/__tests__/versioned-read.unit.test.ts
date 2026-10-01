/**
 * A versioned read through the one execution path: the handler answers its own data, and the
 * host answers `unchanged` or the version and the data.
 * Spec: packages/api/specs/versioned-reads.feature.
 */

import { moduleApi } from "@langwatch/kernel";
import { defineTrpcContract } from "@langwatch/kernel/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

interface GraphApi {
  read(input: { projectId: string }): Promise<{ names: string[] }>;
}

const GraphApi = moduleApi<GraphApi>()("annotation");

const contract = defineTrpcContract("graph")
  .query("read", { cache: { tier: "session", persist: true, versioned: true } })
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ names: z.array(z.string()) }))
  .build();

type GraphContext = { actor: { id: string } };

const root = TrpcRootDefinition.forContext<GraphContext>().create({});

const members: TrpcRuntimeMembers<GraphContext> = {
  identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
  authorization: {
    forRequest: () => ({
      getDecision: async () => ({ permitted: true, organizationRole: null }),
      getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
    }),
  },
  denials: {
    membershipDisabled: () => new Error("membership disabled"),
    liteMemberRestricted: () => new Error("lite member"),
  },
  audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
  errors: {
    report: () => {},
    asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
    translate: () => undefined,
  },
};

/** A graph whose names the test changes between asks, and the inputs its handler was handed. */
function graphReadBy(userId: string) {
  const state = { names: ["alpha"] };
  const seen: unknown[] = [];
  const runtime = createTrpcRuntime({ root, procedure: root.procedure, members });

  const declaration = defineTrpcRouter(GraphApi, contract)
    .procedure("read")
    .withPermission("annotations:view")
    .handle(({ app, input }) => {
      seen.push(input);

      return app.read(input);
    })
    .build();

  const app: GraphApi = { read: async () => ({ names: state.names }) };
  const caller = runtime.mount(declaration, () => app).createCaller({ actor: { id: userId } });

  return { state, seen, read: caller.read };
}

describe("a versioned read", () => {
  /** @scenario "A caller holding no version is answered the version and the data" */
  it("answers the version and the data when no since is sent", async () => {
    const { read } = graphReadBy("user-1");

    const answer = await read({ projectId: "project-1" });

    expect(answer).toEqual({ version: expect.any(String), data: { names: ["alpha"] } });
  });

  /** @scenario "A caller holding the current version is answered unchanged" */
  it("answers unchanged when since is the version the answer carries", async () => {
    const { read } = graphReadBy("user-1");
    const first = await read({ projectId: "project-1" });
    if (!("version" in first)) throw new Error("expected a version");

    const again = await read({ projectId: "project-1", since: first.version });

    expect(again).toEqual({ unchanged: true });
  });

  /** @scenario "A caller holding an older version is answered the new one" */
  it("answers the new version and data when the answer changed since", async () => {
    const { state, read } = graphReadBy("user-1");
    const first = await read({ projectId: "project-1" });
    if (!("version" in first)) throw new Error("expected a version");
    state.names = ["alpha", "beta"];

    const later = await read({ projectId: "project-1", since: first.version });

    if (!("version" in later)) throw new Error("expected a new version");
    expect(later.version).not.toBe(first.version);
    expect(later.data).toEqual({ names: ["alpha", "beta"] });
  });

  /** @scenario "The handler is never handed since" */
  it("hands the handler the read's own arguments and no since", async () => {
    const { seen, read } = graphReadBy("user-1");

    await read({ projectId: "project-1", since: "held" });

    expect(seen).toEqual([{ projectId: "project-1" }]);
  });

  /** @scenario "No user's version matches another's" */
  it("gives two users with identical answers different versions", async () => {
    const first = await graphReadBy("user-1").read({ projectId: "project-1" });
    const second = await graphReadBy("user-2").read({ projectId: "project-1" });
    if (!("version" in first) || !("version" in second)) throw new Error("expected versions");

    expect(first.version).not.toBe(second.version);
  });
});
