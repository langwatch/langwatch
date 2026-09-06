/**
 * The fluent tRPC chain: what it builds at runtime, what it refuses to build
 * at all, and — in the `Equal<>` assertions, which only `tsc` checks — that a
 * chain-built router is the SAME type the hand-written one produced.
 */

// Spec: packages/api/specs/trpc-framework.feature.

import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TrpcRootDefinition } from "../trpc-root.ts";
import {
  createTrpcProcedure,
  createTrpcService,
  type TrpcPolicyDecorator,
} from "../trpc-service-builder.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

type TestContext = { actor: { id: string } };

const root = TrpcRootDefinition.forContext<TestContext>().create({});

/** Records what was declared, and proves the policy ran around the handler. */
function recordingPolicy() {
  const declarations: (AuthzPermission | AuthzDeclaration)[] = [];
  const order: string[] = [];
  const policy = (access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator => {
    declarations.push(access);
    return <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as { use(middleware: unknown): TProcedure }).use(
        async ({ next, input }: { next: () => Promise<unknown>; input: unknown }) => {
          order.push(`policy:${JSON.stringify(input)}`);
          return next();
        },
      );
  };
  return { declarations, order, policy };
}

function serviceUnder({
  policy,
  validateOutput = false,
}: {
  policy: (access: AuthzPermission | AuthzDeclaration) => TrpcPolicyDecorator;
  validateOutput?: boolean;
}) {
  return createTrpcService({
    root,
    procedures: { protected: root.procedure, policy },
    validateOutput,
  });
}

describe("createTrpcService", () => {
  describe("when a procedure declares an input, an output and a permission", () => {
    /** @scenario "A chain-defined procedure runs the process policy around its parsed input" */
    it("parses the input before the policy, and answers through the handler", async () => {
      const { declarations, order, policy } = recordingPolicy();
      const router = serviceUnder({ policy })
        .query("getProject", (p) =>
          p
            .withInput(z.object({ projectId: z.string() }))
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(({ ctx, input }) => {
              order.push(`handler:${ctx.actor.id}`);
              return { id: input.projectId };
            }),
        )
        .build();

      const caller = router.createCaller({ actor: { id: "actor-1" } });

      await expect(caller.getProject({ projectId: "project-1" })).resolves.toEqual({
        id: "project-1",
      });
      expect(declarations).toEqual(["project:view"]);
      // The policy saw the PARSED input, which is only true when the parser
      // was applied to the procedure first.
      expect(order).toEqual(['policy:{"projectId":"project-1"}', "handler:actor-1"]);
    });

    /** @scenario "A chain-defined procedure runs the process policy around its parsed input" */
    it("refuses input its declared schema refuses, before the policy runs", async () => {
      const { order, policy } = recordingPolicy();
      const router = serviceUnder({ policy })
        .query("getProject", (p) =>
          p
            .withInput(z.object({ projectId: z.string() }))
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(({ input }) => ({ id: input.projectId })),
        )
        .build();

      await expect(
        router.createCaller({ actor: { id: "actor-1" } }).getProject({ projectId: 7 } as never),
      ).rejects.toThrow();
      expect(order).toEqual([]);
    });
  });

  describe("when a whole declaration or a process-built policy is declared", () => {
    /** @scenario "A chain-defined procedure runs the process policy around its parsed input" */
    it("passes the declaration through untouched, and applies a custom policy in its place", async () => {
      const { declarations, policy } = recordingPolicy();
      const serviceAuthorized: AuthzDeclaration = {
        kind: "service-authorized",
        reason: "the scope is the row the resolver loads",
        permissions: ["project:view"],
      };
      const applied: string[] = [];
      const custom: TrpcPolicyDecorator = <TProcedure>(procedure: TProcedure): TProcedure => {
        applied.push("custom");
        return procedure;
      };

      const router = serviceUnder({ policy })
        .mutation("archive", (p) =>
          p
            .withInput(z.object({ projectId: z.string() }))
            .withOutput(z.object({ archived: z.boolean() }))
            .withPermission(serviceAuthorized)
            .handle(() => ({ archived: true })),
        )
        .mutation("create", (p) =>
          p
            .withInput(z.object({ name: z.string() }))
            .withOutput(z.object({ created: z.boolean() }))
            .withCustomPermission(custom, "the tier depends on what was asked for")
            .handle(() => ({ created: true })),
        )
        .build();

      const caller = router.createCaller({ actor: { id: "actor-1" } });
      await expect(caller.archive({ projectId: "project-1" })).resolves.toEqual({ archived: true });
      await expect(caller.create({ name: "new" })).resolves.toEqual({ created: true });
      expect(declarations).toEqual([serviceAuthorized]);
      expect(applied).toEqual(["custom"]);
    });
  });

  describe("when the process asks for output validation", () => {
    /** @scenario "An answer that its declared output schema refuses is raised where it is cheap to find" */
    it("names the procedure and the offending field, and leaves the answer untouched when it fits", async () => {
      const { policy } = recordingPolicy();
      const service = serviceUnder({ policy, validateOutput: true });
      const router = service
        .query("wrong", (p) =>
          p
            .withoutInput("nothing is asked of the caller")
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(() => ({ id: 7 }) as unknown as { id: string }),
        )
        .query("right", (p) =>
          p
            .withoutInput("nothing is asked of the caller")
            // Extra fields are kept: the handler's own value is returned, not
            // the parsed one, so validating never strips what a client reads.
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(() => ({ id: "project-1", extra: true })),
        )
        .build();

      const caller = router.createCaller({ actor: { id: "actor-1" } });
      await expect(caller.wrong()).rejects.toThrow(
        /tRPC procedure "wrong" answered with a value its declared output schema refuses: id:/,
      );
      await expect(caller.right()).resolves.toEqual({ id: "project-1", extra: true });
    });

    /** @scenario "An answer that its declared output schema refuses is raised where it is cheap to find" */
    it("checks nothing when the process did not ask, which is how production runs", async () => {
      const { policy } = recordingPolicy();
      const router = serviceUnder({ policy })
        .query("wrong", (p) =>
          p
            .withoutInput("nothing is asked of the caller")
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(() => ({ id: 7 }) as unknown as { id: string }),
        )
        .build();

      await expect(router.createCaller({ actor: { id: "actor-1" } }).wrong()).resolves.toEqual({
        id: 7,
      });
    });
  });

  describe("when a procedure omits a declaration", () => {
    /** @scenario "A procedure cannot be built without an authorization declaration" */
    it("offers no callable handle, so the procedure does not compile", () => {
      const { policy } = recordingPolicy();
      const service = serviceUnder({ policy });
      // `handle`'s `this` is `never` until input, output and access are all
      // declared, which is TS2684 at the call site.
      type NoPermissionChain = Parameters<Parameters<typeof service.query>[1]>[0];
      type Undeclared = NoPermissionChain["handle"];
      type WithInputOnly = ReturnType<NoPermissionChain["withInput"]>["handle"];
      type Declared = ReturnType<
        ReturnType<ReturnType<NoPermissionChain["withInput"]>["withOutput"]>["withPermission"]
      >["handle"];

      type _NothingDeclaredRefusesHandle = Assert<Equal<ThisParameterType<Undeclared>, never>>;
      type _InputAloneRefusesHandle = Assert<Equal<ThisParameterType<WithInputOnly>, never>>;
      type _FullyDeclaredAcceptsHandle = Assert<
        Equal<ThisParameterType<Declared> extends never ? false : true, true>
      >;

      expect(true satisfies _NothingDeclaredRefusesHandle).toBe(true);
      expect(true satisfies _InputAloneRefusesHandle).toBe(true);
      expect(true satisfies _FullyDeclaredAcceptsHandle).toBe(true);
    });
  });

  describe("when the same router is written by hand", () => {
    /** @scenario "A chain-built router is the same type the client already sees" */
    it("has the same type, not merely an assignable one", async () => {
      const { policy } = recordingPolicy();
      const input = z.object({ projectId: z.string() });
      const handler = ({ input: parsed }: { input: { projectId: string } }) => ({
        id: parsed.projectId,
      });

      const chained = serviceUnder({ policy })
        .query("getProject", (p) =>
          p
            .withInput(input)
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(handler),
        )
        .build();
      const handwritten = root.router({
        getProject: policy("project:view")(root.procedure.input(input)).query(handler),
      });

      type _SameRouterType = Assert<Equal<typeof chained, typeof handwritten>>;
      expect(true satisfies _SameRouterType).toBe(true);

      await expect(
        chained.createCaller({ actor: { id: "actor-1" } }).getProject({ projectId: "p" }),
      ).resolves.toEqual(
        await handwritten.createCaller({ actor: { id: "actor-1" } }).getProject({ projectId: "p" }),
      );
    });
  });
});

describe("createTrpcService.subscription", () => {
  describe("given a stream declared through the chain", () => {
    /** @scenario "A stream declared through the chain is the same procedure the client subscribes to" */
    it("is the same type the hand-written subscription produced, and yields through the policy", async () => {
      const { declarations, order, policy } = recordingPolicy();
      const input = z.object({ projectId: z.string() });
      const handler = async function* ({ input: parsed }: { input: { projectId: string } }) {
        yield { id: `${parsed.projectId}-1` };
        yield { id: `${parsed.projectId}-2` };
      };

      const chained = serviceUnder({ policy })
        .subscription("watch", (p) =>
          p
            .withInput(input)
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(handler),
        )
        .build();
      const handwritten = root.router({
        watch: policy("project:view")(root.procedure.input(input)).subscription(handler),
      });

      type _SameProcedureType = Assert<Equal<typeof chained, typeof handwritten>>;
      expect(true satisfies _SameProcedureType).toBe(true);

      const seen: { id: string }[] = [];
      for await (const value of await chained
        .createCaller({ actor: { id: "actor-1" } })
        .watch({ projectId: "p" })) {
        seen.push(value);
      }

      expect(seen).toEqual([{ id: "p-1" }, { id: "p-2" }]);
      expect(declarations).toEqual(["project:view", "project:view"]);
      expect(order).toEqual(['policy:{"projectId":"p"}']);
    });

    /** @scenario "A stream declared through the chain is the same procedure the client subscribes to" */
    it("checks every value it yields against the declared shape, not only the first", async () => {
      const { policy } = recordingPolicy();
      const router = serviceUnder({ policy, validateOutput: true })
        .subscription("watch", (p) =>
          p
            .withoutInput("the stream is scoped by the caller's own session")
            .withOutput(z.object({ id: z.string() }))
            .withPermission("project:view")
            .handle(async function* () {
              yield { id: "first" };
              yield { id: 2 } as unknown as { id: string };
            }),
        )
        .build();

      const seen: unknown[] = [];
      await expect(
        (async () => {
          for await (const value of await router
            .createCaller({ actor: { id: "actor-1" } })
            .watch()) {
            seen.push(value);
          }
        })(),
      ).rejects.toThrow(
        /tRPC procedure "watch" answered with a value its declared output schema refuses: id:/,
      );
      expect(seen).toEqual([{ id: "first" }]);
    });
  });
});

describe("a surface that is one procedure", () => {
  /** @scenario "A surface that is one procedure declares it on the same chain" */
  it("hands back the procedure itself, declarations and all", async () => {
    const { declarations, policy } = recordingPolicy();
    const publicEnv = createTrpcProcedure({
      procedures: { protected: root.procedure, policy },
    }).query("publicEnv", (p) =>
      p
        .withoutInput("the environment is the same for every caller")
        .withOutput(z.object({ region: z.string() }))
        .withPermission("project:view")
        .handle(async () => ({ region: "eu" })),
    );

    expect(publicEnv._def.procedure).toBe(true);
    expect(publicEnv._def.type).toBe("query");
    expect(declarations).toEqual(["project:view"]);

    const caller = root.router({ publicEnv }).createCaller({ actor: { id: "u1" } });
    await expect(caller.publicEnv()).resolves.toEqual({ region: "eu" });
  });
});

describe("a service mounting a child router", () => {
  /** @scenario "A service mounts a child router without writing a record by hand" */
  it("nests it exactly where hand-writing the record put it", async () => {
    const { policy } = recordingPolicy();
    const child = createTrpcService({
      root,
      procedures: { protected: root.procedure, policy },
    })
      .query("list", (p) =>
        p
          .withoutInput("the caller's own suites")
          .withOutput(z.array(z.string()))
          .withPermission("project:view")
          .handle(async () => ["one"]),
      )
      .build();

    const parent = createTrpcService({
      root,
      procedures: { protected: root.procedure, policy },
    })
      .query("count", (p) =>
        p
          .withoutInput("no argument")
          .withOutput(z.number())
          .withPermission("project:view")
          .handle(async () => 1),
      )
      .router("testSuites", child)
      .build();

    const caller = parent.createCaller({ actor: { id: "u1" } });
    await expect(caller.testSuites.list()).resolves.toEqual(["one"]);
    await expect(caller.count()).resolves.toBe(1);
  });
});

describe("a surface whose every procedure carries its own policy", () => {
  /** @scenario "A surface whose every procedure carries its own policy declares none" */
  it("builds with no policy, and refuses withPermission by name", async () => {
    const seen: string[] = [];
    const own: TrpcPolicyDecorator = <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as { use(middleware: unknown): TProcedure }).use(
        async ({ next }: { next: () => Promise<unknown> }) => {
          seen.push("own");
          return next();
        },
      );

    const built = createTrpcService({ root, procedures: { protected: root.procedure } })
      .query("whoami", (p) =>
        p
          .withoutInput("the caller is the argument")
          .withOutput(z.string())
          .withCustomPermission(own, "the connection's own installation check authorizes this")
          .handle(async () => "u1"),
      )
      .build();

    const caller = built.createCaller({ actor: { id: "u1" } });
    await expect(caller.whoami()).resolves.toBe("u1");
    expect(seen).toEqual(["own"]);

    expect(() =>
      createTrpcService({ root, procedures: { protected: root.procedure } }).query("nope", (p) =>
        p
          .withoutInput("none")
          .withOutput(z.string())
          .withPermission("project:view")
          .handle(async () => "x"),
      ),
    ).toThrow(/declares withPermission, but the surface was opened with no policy/);
  });
});
