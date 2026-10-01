/**
 * The two schemas a versioned read adds around its own declaration: the optional `since` on
 * its input, and the envelope on its output. Spec: packages/api/specs/versioned-reads.feature.
 */
import { z } from "zod";

/** The read's own input plus `since`, the version the caller already holds. */
export function withSince({ address, input }: { address: string; input: z.ZodObject }) {
  if (!(input instanceof z.ZodObject)) {
    throw new Error(`${address} is versioned, so its input must be a Zod object`);
  }

  if ("since" in input.shape) {
    throw new Error(`${address} is versioned, which adds "since" to its input; declare it once`);
  }

  return input.extend({ since: z.string().optional() });
}

/** `{ unchanged: true }` for a caller on the current version, else the data and its version. */
export function versionedAnswer<Data extends z.ZodType>(data: Data) {
  return z.union([
    z.object({ unchanged: z.literal(true) }),
    z.object({ version: z.string(), data }),
  ]);
}

/** The declared input with `since` joined to it, stated rather than derived from the extend. */
export type VersionedInput<Input extends z.ZodObject> = z.ZodType<
  z.output<Input> & { since?: string | undefined },
  z.input<Input> & { since?: string | undefined }
>;
export type VersionedAnswerSchema<Data extends z.ZodType> = ReturnType<
  typeof versionedAnswer<Data>
>;
