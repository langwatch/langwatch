import { z } from "zod";

const coded = z.union([
  z.object({ body: z.object({ code: z.string() }) }).transform((error) => error.body.code),
  z.object({ code: z.string() }).transform((error) => error.code),
]);

/** Whether better-auth refused with one of these codes, read off its APIError body first. */
export function refusedWith(error: unknown, codes: readonly string[]): boolean {
  const parsed = coded.safeParse(error);
  return parsed.success && codes.includes(parsed.data);
}
