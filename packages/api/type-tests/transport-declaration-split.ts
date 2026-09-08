/**
 * What the transport declaration split refuses, asserted at the type level.
 *
 * Each `@ts-expect-error` fails the build if the line ever STOPS being an
 * error, so widening one of these surfaces breaks this file rather than
 * quietly removing a guarantee from every feature.
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import type { FeatureApiWitness } from "@langwatch/api/rest";
import { defineRestRouter } from "@langwatch/api/rest";
import type { TrpcFeatureApiWitness } from "@langwatch/api/trpc";
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

interface AnnotationApi {
  getById(input: { id: string }): Promise<{ id: string; comment: string }>;
  deleteById(input: { id: string }): Promise<void>;
}

declare const trpcApi: TrpcFeatureApiWitness<AnnotationApi>;
declare const restApi: FeatureApiWitness<AnnotationApi>;

const scope = z.object({ projectId: z.string(), id: z.string() });
const annotation = z.object({ id: z.string(), comment: z.string() });

const contract = defineTrpcContract("annotation")
  .query("getById")
  .withInput(scope)
  .withOutput(annotation)
  .mutation("deleteById")
  .withInput(scope)
  .build();

// ---------------------------------------------------------------------------
// The contract carries the names, kinds and schemas as types
// ---------------------------------------------------------------------------

type _NamespaceIsLiteral = Assert<Equal<(typeof contract)["namespace"], "annotation">>;
type _KindTravels = Assert<Equal<(typeof contract)["members"]["getById"]["kind"], "query">>;
type _OutputIsAbsent = Assert<
  Equal<(typeof contract)["members"]["deleteById"]["output"], undefined>
>;

// ---------------------------------------------------------------------------
// The server repeats nothing the contract said
// ---------------------------------------------------------------------------

const router = defineTrpcRouter(trpcApi, contract)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) => app.getById({ id: input.id }))
  .procedure("deleteById")
  .withPermission("annotations:delete")
  .handle(async ({ app, input }) => app.deleteById({ id: input.id }))
  .build();

type _NamespaceReachesTheDeclaration = Assert<Equal<(typeof router)["namespace"], "annotation">>;

/** The handler's input is the contract's PARSED input, not a repeated schema. */
defineTrpcRouter(trpcApi, contract)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(async ({ input }) => {
    type _InputIsTheContracts = Assert<Equal<typeof input, { projectId: string; id: string }>>;
    return { id: input.id, comment: "" };
  });

// ---------------------------------------------------------------------------
// Refusal 1: a procedure the contract does not declare
// ---------------------------------------------------------------------------

defineTrpcRouter(trpcApi, contract)
  // @ts-expect-error — "archive" is not a procedure this contract declares.
  .procedure("archive");

// ---------------------------------------------------------------------------
// Refusal 2: the same procedure implemented twice
// ---------------------------------------------------------------------------

defineTrpcRouter(trpcApi, contract)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(async () => ({ id: "", comment: "" }))
  // @ts-expect-error — "getById" already has an implementation.
  .procedure("getById");

// ---------------------------------------------------------------------------
// Refusal 3: building with a procedure left unimplemented
// ---------------------------------------------------------------------------

const incomplete = defineTrpcRouter(trpcApi, contract)
  .procedure("getById")
  .withPermission("annotations:view")
  .handle(async () => ({ id: "", comment: "" }));
// @ts-expect-error — "deleteById" has no implementation.
incomplete.build();

// ---------------------------------------------------------------------------
// Refusal 4: a handler with no access decision in front of it
// ---------------------------------------------------------------------------

defineTrpcRouter(trpcApi, contract)
  .procedure("getById")
  // @ts-expect-error — `handle` appears only after an access decision.
  .handle(async () => ({ id: "", comment: "" }));

// ---------------------------------------------------------------------------
// Refusal 5: data answered by a procedure declared without output
// ---------------------------------------------------------------------------

defineTrpcRouter(trpcApi, contract)
  .procedure("deleteById")
  .withPermission("annotations:delete")
  // @ts-expect-error — "deleteById" declares no output, so it answers nothing.
  .handle(async () => ({ id: "" }));

/** The same refusal the other way: an answer the output schema does not accept. */
defineTrpcRouter(trpcApi, contract)
  .procedure("getById")
  .withPermission("annotations:view")
  // @ts-expect-error — the declared output requires `comment`.
  .handle(async () => ({ id: "" }));

// ---------------------------------------------------------------------------
// Refusal 6: a params schema whose keys are not the path's parameters
// ---------------------------------------------------------------------------

defineRestRouter(restApi)
  .withNamespace("annotations")
  .withVersion("2026-09-08")
  .get("/:id", "getAnnotation")
  // @ts-expect-error — the path names `id`, the schema names `annotationId`.
  .withParams(z.object({ annotationId: z.string() }));

/** A route with no permission has no handler to call. */
const unpermitted = defineRestRouter(restApi)
  .withNamespace("annotations")
  .withVersion("2026-09-08")
  .get("/", "listAnnotations");
// @ts-expect-error — `handle` requires an access decision first.
unpermitted.handle(() => {});
