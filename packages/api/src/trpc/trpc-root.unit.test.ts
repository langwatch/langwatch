import { describe, expect, it } from "vitest";
import { TrpcRootDefinition } from "./trpc-root";

describe("TrpcRootDefinition", () => {
  it("builds a caller whose procedure receives the declared context", async () => {
    const root = TrpcRootDefinition.forContext<{ actor: { id: string } }>().create({});
    const router = root.router({
      actorId: root.procedure.query(({ ctx }) => ctx.actor.id),
    });

    await expect(router.createCaller({ actor: { id: "actor-1" } }).actorId()).resolves.toBe(
      "actor-1",
    );
  });
});
