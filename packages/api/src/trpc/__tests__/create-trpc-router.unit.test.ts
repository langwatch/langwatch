import { describe, expect, expectTypeOf, it } from "vitest";
import { TrpcRootDefinition } from "../trpc-root.ts";
import { createTrpcRouter } from "../create-trpc-router.ts";

type Context = Readonly<{ actorId: string }>;
const root = TrpcRootDefinition.forContext<Context>().create({});

describe("createTrpcRouter", () => {
  it("preserves the native router factory and its procedure types", () => {
    let calls = 0;
    const router = (mount: typeof root) => {
      calls += 1;
      return mount.router({
        actor: mount.procedure.query(({ ctx }) => ctx.actorId),
      });
    };

    const descriptor = createTrpcRouter(router);

    expect(descriptor).toEqual({ protocol: "trpc", router });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(descriptor.router).toBe(router);
    expect(calls).toBe(0);
    expectTypeOf(descriptor.router).toEqualTypeOf<typeof router>();
    expectTypeOf<ReturnType<typeof descriptor.router>>().toMatchTypeOf<object>();
  });
});
