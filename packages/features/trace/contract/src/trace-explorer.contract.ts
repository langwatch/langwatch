import { z } from "zod";
import { TRACE_NAME_MIN_LENGTH } from "./trace.constants";

/**
 * The transport inputs and results the trace EXPLORER's browser code sends, as
 * opposed to the domain values it renders.
 *
 * They live in the contract because two packages have to agree on them and
 * neither may import the other: `@langwatch/trace-server` parses them at the
 * tRPC procedure, and `@langwatch/trace-web` types its hooks against them
 * through the portable router shape in `@langwatch/platform-api-contract`. A
 * copy in either package would be a copy that can drift.
 */

/**
 * `tracesV2.header`, as the browser sends it.
 *
 * `full` is optional here and required after parsing: the procedure defaults it
 * to `true`, so the CLIENT-facing input is `z.input` of the schema, not
 * `z.output`. Declaring it required in a browser-side type is the easiest way
 * to make a correct call site fail to compile.
 */
export const traceHeaderReadInputSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  /**
   * Approximate trace timestamp (ms since epoch), used as a partition-pruning
   * hint. Omitting it makes the read walk every partition, cold S3 included.
   */
  occurredAtMs: z.number().int().optional(),
  /** Resolve offloaded (ADR-022) input/output in full. Costs one extra spans read. */
  full: z.boolean().default(true),
});

export type TraceHeaderReadInput = z.input<typeof traceHeaderReadInputSchema>;

/** `tracesV2.changeName`, as the browser sends it. */
export const changeTraceNameCommandSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  newName: z.string(),
});

export type ChangeTraceNameCommand = z.infer<typeof changeTraceNameCommandSchema>;

/** What `tracesV2.changeName` returns: the canonical name the trace now has. */
export const changeTraceNameResultSchema = z.object({
  traceId: z.string(),
  newName: z.string(),
});

export type ChangeTraceNameResult = z.infer<typeof changeTraceNameResultSchema>;

/**
 * The `meta` a rejected rename carries, so the browser can say which limit was
 * exceeded and by how much. `HandledError.meta` is a client contract: these
 * four fields exist because this copy reads them.
 */
export type ChangeTraceNameRejectionMeta = {
  field: "newName";
  minLength: number;
  maxLength: number;
  receivedLength: number;
};

/**
 * Reads a rename rejection out of an unknown transport error.
 *
 * Lives in the contract rather than in the browser because the shape is the
 * server's; the words the customer reads are the browser's, and stay there.
 */
export function readChangeTraceNameRejection(
  meta: unknown,
): ChangeTraceNameRejectionMeta | undefined {
  if (typeof meta !== "object" || meta === null) return void 0;
  const candidate = meta as Record<string, unknown>;
  if (candidate.field !== "newName") return void 0;
  if (typeof candidate.maxLength !== "number") return void 0;
  if (typeof candidate.receivedLength !== "number") return void 0;

  return {
    field: "newName",
    minLength:
      typeof candidate.minLength === "number" ? candidate.minLength : TRACE_NAME_MIN_LENGTH,
    maxLength: candidate.maxLength,
    receivedLength: candidate.receivedLength,
  };
}
