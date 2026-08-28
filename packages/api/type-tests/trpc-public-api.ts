import { TrpcRootDefinition, type PendingPermissionProcedureBuilder } from "@langwatch/api/trpc";
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

/**
 * The structural guarantee: after `.input()` a pending builder offers the
 * declaring methods and NOTHING else. No `.query`, no `.mutation`, no
 * `.subscription` — so a procedure that declares no authorization cannot be
 * built at all, rather than being caught later by a sweep. Widen this surface
 * and roughly 800 procedures quietly lose the guarantee; this assertion is
 * what refuses the widening.
 */
type Pending = PendingPermissionProcedureBuilder<
  { permissionChecked: boolean },
  { actor: { id: string } },
  object,
  object,
  { projectId: string },
  { projectId: string },
  unknown,
  unknown,
  false
>;

type _DeclarationIsMandatoryByConstruction = Assert<
  Equal<
    keyof Pending,
    "input" | "use" | "permission" | "permissionAny" | "noPermission" | "authorizeInService"
  >
>;
