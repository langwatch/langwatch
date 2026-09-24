import type { z } from "zod";

import type { Event } from "./types.ts";

/** A contract's whole, versioned zod event schema, keyed by its `type` literal (§9). */
export type PipelineEventSchema<E extends Event = Event> = z.ZodType<E> & {
  readonly shape: { readonly type: z.ZodLiteral<E["type"]> };
};

export type UndeclaredEventTypes<
  E extends Event,
  Schemas extends readonly PipelineEventSchema<E>[],
> = Exclude<E["type"], z.output<Schemas[number]>["type"]>;

export type EventSchemaCoverage<
  E extends Event,
  Schemas extends readonly PipelineEventSchema<E>[],
> = [UndeclaredEventTypes<E, Schemas>] extends [never]
  ? unknown
  : { readonly undeclaredEventTypes: UndeclaredEventTypes<E, Schemas> };

export function indexEventSchemas<E extends Event>({
  pipelineName,
  schemas,
}: {
  pipelineName: string;
  schemas: readonly PipelineEventSchema<E>[];
}): ReadonlyMap<string, PipelineEventSchema<E>> {
  const byType = new Map<string, PipelineEventSchema<E>>();
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
