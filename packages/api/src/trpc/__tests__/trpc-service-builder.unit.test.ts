/**
 * The fluent tRPC chain: what it builds at runtime, and what it refuses to
 * build at all. The compile-time half — that a router built through the chain
 * is the SAME type the hand-written `router({ … })` produced — is the type
 * assertion in this file plus `packages/api/type-tests/trpc-service-chain.ts`.
 *
 * Spec: packages/api/specs/trpc-framework.feature.
 */
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TrpcRootDefinition } from "../trpc-root.js";
import { createTrpcService, type TrpcPolicyDecorator } from "../trpc-service-builder.js";

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
