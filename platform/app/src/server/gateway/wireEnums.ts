/**
 * Casing at the REST wire seam.
 *
 * Every enum LangWatch publishes is lower_snake_case, matching the rest of the
 * wire's key casing and the OpenAI-compatible surfaces callers already read.
 * The database stores the same values SCREAMING_SNAKE, because that is Prisma's
 * enum convention. These two helpers are the only place that translation
 * happens for the public REST routes.
 *
 * The gateway's own control-plane payload (`config.materialiser.ts`) and the
 * governance webhook envelopes already emit lowercase; the REST surface was the
 * one that leaked Prisma's casing onto the wire, which is what this closes.
 *
 * Both are typed on template literal types rather than `string`, so a value
 * that is not one of the schema's literals is a compile error at the call site
 * and the mapped union stays exact instead of widening to `string`.
 */

/** The wire spelling of a stored enum value: `"BLOCK"` becomes `"block"`. */
export function toWireEnum<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

/** The stored spelling of a wire enum value: `"block"` becomes `"BLOCK"`. */
export function toStoredEnum<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}
