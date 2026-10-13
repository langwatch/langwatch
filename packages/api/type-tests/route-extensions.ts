/**
 * What the compiler accepts for E1 and E3. Specs: packages/api/specs/transport-conventions.feature,
 * transport-declaration-split.feature.
 */
import { permissionBy } from "@langwatch/api/access";
import { defineRestRouter, type FeatureApiWitness } from "@langwatch/api/rest";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

interface LocalApi {
  startCall(input: unknown): Promise<{ callId: string }>;
}

declare const restApi: FeatureApiWitness<LocalApi>;

// The shape of langy's `langyLocalStartCallRequestSchema`: an object intersected with a union.
const startCall = z
  .object({ conversationId: z.string(), turnId: z.string() })
  .and(
    z.discriminatedUnion("tool", [
      z.object({ tool: z.literal("local_read"), params: z.object({ path: z.string() }) }),
      z.object({ tool: z.literal("local_ls"), params: z.object({ depth: z.number() }) }),
    ]),
  );

defineRestRouter(restApi)
  .withNamespace("local")
  .withVersion("2026-10-05")
  .post("/calls", "startCall")
  .withInput(startCall)
  .withPermission("project:view")
  .withOutput(z.object({ callId: z.string() }))
  .handle(({ input }) => {
    const handed: Assert<Equal<typeof input, z.output<typeof startCall>>> = true;

    return { callId: handed && input.tool === "local_ls" ? `${input.params.depth}` : "read" };
  })

  .post("/steps", "startCall")
  .withInput(z.array(z.object({ index: z.number() })), { as: "steps" })
  .withPermission("project:view")
  .withOutput(z.object({ callId: z.string() }))
  .handle(({ input }) => {
    const handed: Assert<Equal<typeof input, { steps: { index: number }[] }>> = true;

    return { callId: handed ? `${input.steps.length}` : "" };
  })

  .post("/choice", "startCall")
  .withInput(z.object({ kind: z.enum(["read", "write"]) }))
  .withPermission(
    permissionBy({ field: "kind", map: { read: "project:view", write: "project:update" } }),
  )
  .withOutput(z.object({ callId: z.string() }))
  .handle(() => ({ callId: "choice" }))

  .post("/missing", "startCall")
  .withInput(z.object({ kind: z.enum(["read", "write"]) }))
  // @ts-expect-error a value of the field has no permission
  .withPermission(permissionBy({ field: "kind", map: { read: "project:view" } }));
