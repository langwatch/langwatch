/**
 * Structural JSON value, identical in shape to Prisma's `JsonValue`. The
 * domain package cannot import `@prisma/client`, so column types that are
 * `Json` in the schema use this instead; the app-side parity test pins the
 * two as mutually assignable.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];
