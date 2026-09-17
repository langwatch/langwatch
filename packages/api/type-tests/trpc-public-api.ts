import {
  createTrpcErrorFormatter,
  TrpcRootDefinition,
  trpcFailureTraceIds,
  type PendingPermissionProcedureBuilder,
} from "@langwatch/api/trpc";
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

/** Ensures pending builders cannot become procedures before authorization. */
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

/**
 * tRPC derives `errorShape` from the LITERAL type of the options object handed to `create`,
 * so the root must be created on the builder itself — a wrapper infers `never` instead, and
 * every `error.data.code` read silently becomes a read off `never`; this assertion refuses it.
 */
const errorFormatter = createTrpcErrorFormatter({
  causePayload: { payloadFor: () => null },
  traceIds: trpcFailureTraceIds,
});
const configuredRoot = TrpcRootDefinition.forContext<{ actor: { id: string } }>().create({
  errorFormatter,
});
type ConfiguredErrorData = (typeof configuredRoot)["_config"]["$types"]["errorShape"]["data"];

type _ErrorShapeReachesTheRoot = Assert<Equal<ConfiguredErrorData["httpStatus"], number>>;
