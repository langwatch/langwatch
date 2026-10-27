import type { z } from "zod";

import type { Event } from "./types.ts";

/** A contract's whole, versioned zod event schema, keyed by its `type` literal (§9). */
/** The zod schema surface eventing reads; core-typed so no zod class variance is measured. */
export interface ParsingSchema<Output = unknown> extends z.core.$ZodType<Output> {
  parse(data: unknown): z.output<this>;
  safeParse(data: unknown): z.ZodSafeParseResult<z.output<this>>;
}

export type PipelineEventSchema<E extends Event = Event> = ParsingSchema<E> & {
  readonly shape: {
    readonly type: z.core.$ZodType<E["type"]> & { readonly values: ReadonlySet<E["type"]> };
  };
};

export function indexEventSchemas<Schema extends PipelineEventSchema>({
  pipelineName,
  schemas,
}: {
  pipelineName: string;
  schemas: readonly Schema[];
}): ReadonlyMap<string, Schema> {
  const byType = new Map<string, Schema>();
  for (const schema of schemas) {
    const literals = [...schema.shape.type.values];
    const [type] = literals;
    if (literals.length !== 1 || typeof type !== "string") {
      throw new Error(
        `Pipeline "${pipelineName}" declares an event schema whose type is not one string literal`,
      );
    }
    if (byType.has(type)) {
      throw new Error(`Pipeline "${pipelineName}" declares event "${type}" more than once`);
    }
    byType.set(type, schema);
  }
  return byType;
}
