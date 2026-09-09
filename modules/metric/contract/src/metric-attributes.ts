import { z } from "zod";

const canonicalScalarAttributeSchema = z.object({
  key: z.string(),
  value: z.discriminatedUnion("type", [
    z.object({ type: z.literal("string"), value: z.string() }),
    z.object({ type: z.literal("int"), value: z.string() }),
    z.object({ type: z.literal("bool"), value: z.boolean() }),
    z.object({ type: z.literal("double"), value: z.number() }),
  ]),
});

/** Returns the scalar values that consumers may safely lift from canonical attributes. */
export function scalarsFromCanonicalAttributes(
  attributes: unknown,
): Record<string, string | number | boolean> {
  const parsedAttributes = z.array(z.unknown()).safeParse(attributes);
  if (!parsedAttributes.success) {
    return {};
  }

  const scalars: Record<string, string | number | boolean> = {};
  for (const attribute of parsedAttributes.data) {
    const parsedAttribute = canonicalScalarAttributeSchema.safeParse(attribute);
    if (!parsedAttribute.success) {
      continue;
    }

    scalars[parsedAttribute.data.key] = parsedAttribute.data.value.value;
  }

  return scalars;
}
