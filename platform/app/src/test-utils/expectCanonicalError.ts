import { expect } from "vitest";

import { apiErrorSchema } from "~/app/api/shared/schemas";

/**
 * Asserts a response carries the canonical error envelope, and returns it.
 *
 * Parses with the shipped schema rather than poking at fields, so a route that
 * answers a nearly-right shape (a flat `error` string, a stray top-level
 * `message`) fails here instead of passing a hand-written field check. The
 * optional `code` pins the specific refusal on top of the shape.
 *
 * The envelope is checked STRICTLY at the top level: `error` is the only key.
 * A leftover sibling is exactly how the pre-canonical shapes leaked, and a
 * non-strict parse would silently strip one instead of failing.
 */
export async function expectCanonicalError(
  res: Response,
  expected: { status: number; type?: string; code?: string },
): Promise<{
  type: string;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}> {
  expect(res.status).toBe(expected.status);
  const parsed = apiErrorSchema.strict().safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(
      `response is not the canonical error envelope: ${parsed.error.message}`,
    );
  }
  const { error } = parsed.data;
  // A sentence, never the empty string: this is all a human gets.
  expect(error.message.length).toBeGreaterThan(0);
  if (expected.type !== undefined) expect(error.type).toBe(expected.type);
  if (expected.code !== undefined) expect(error.code).toBe(expected.code);
  return error;
}
