/**
 * Lets an interface name a schema's inferred type, so emitted declarations print the name
 * instead of the whole Zod tree at every use (ADR-178):
 * `export interface FooSchema extends Named<typeof fooSchemaDefinition> {}`.
 */
export type Named<T> = T;
