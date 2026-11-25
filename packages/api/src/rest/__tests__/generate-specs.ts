import type { Hono } from "hono";
import { generateSpecs as honoGenerateSpecs, type GenerateSpecOptions } from "hono-openapi";
import type { BlankEnv, BlankInput, BlankSchema } from "hono/types";

/**
 * hono-openapi's `generateSpecs` infers its generics from the Hono class, which costs the test
 * program tens of thousands of types per program. Naming the generics skips the inference.
 */
export function generateSpecs(app: Hono, options?: Partial<GenerateSpecOptions>) {
  return honoGenerateSpecs<BlankEnv, "/", BlankInput, BlankSchema>(app, options);
}
