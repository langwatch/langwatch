import { TrpcRootDefinition } from "@langwatch/trpc";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const root = TrpcRootDefinition.forContext<{ actor: { id: string } }>().create({});
const router = root.router({
  project: root.procedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => ({ actorId: ctx.actor.id, projectId: input.projectId })),
});
const caller = router.createCaller({ actor: { id: "actor-1" } });
const response = caller.project({ projectId: "project-1" });

type _ContextAndInputRemainConcrete = Assert<
  Equal<Awaited<typeof response>, { actorId: string; projectId: string }>
>;
