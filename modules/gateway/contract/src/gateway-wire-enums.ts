/**
 * Casing translation at REST wire seam: lower_snake_case (wire) ↔
 * SCREAMING_SNAKE (stored); template-typed for compile-time exactness.
 */

/** The wire spelling of a stored enum value: `"BLOCK"` becomes `"block"`. */
export function toWireEnum<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

/** The stored spelling of a wire enum value: `"block"` becomes `"BLOCK"`. */
export function toStoredEnum<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}
