/**
 * What the host does around a versioned read: take `since` off the input before the handler,
 * and answer the envelope from the hash of what the handler returned.
 * Spec: packages/api/specs/versioned-reads.feature.
 */
import { contentVersion } from "./session-version.ts";

/** The wire answer of a versioned read: `unchanged`, or the version and the data. */
export type VersionedWireAnswer = { unchanged: true } | { version: string; data: unknown };

/** The version the caller holds, and the input without it. */
export function splitSince(input: unknown): { since: string | undefined; input: unknown } {
  if (typeof input !== "object" || input === null || !("since" in input)) {
    return { since: undefined, input };
  }

  const { since, ...rest } = input;

  return { since: typeof since === "string" ? since : undefined, input: rest };
}

/** The hash is the version: a caller holding it is answered `unchanged`, else the data. */
export function answerVersioned({
  userId,
  since,
  data,
}: {
  userId: string;
  since: string | undefined;
  data: unknown;
}): VersionedWireAnswer {
  const version = contentVersion({ userId, body: JSON.stringify(data) ?? "" });

  return since === version ? { unchanged: true } : { version, data };
}
