import type { z } from "zod";

import type { Event } from "./types.ts";

/** A contract's whole, versioned zod event schema, keyed by its `type` literal (§9). */
export type PipelineEventSchema<E extends Event = Event> = z.ZodType<E> & {
  readonly shape: { readonly type: z.ZodLiteral<E["type"]> };
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
