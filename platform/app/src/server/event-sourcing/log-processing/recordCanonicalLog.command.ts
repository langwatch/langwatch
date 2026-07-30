import type { EmittedEvent } from "@langwatch/event-sourcing";
import { logProcessingEvents } from "./events";
import type { CanonicalLogRecord } from "./schema";

/**
 * The trust boundary (ADR-105 decision 7). A canonical record already
 * carries everything the event needs — canonicalization, redaction and
 * hashing all happened upstream in `canonicalize.ts` — so this command is a
 * pure function of its input.
 */
export async function recordCanonicalLog(
  input: CanonicalLogRecord,
): Promise<readonly EmittedEvent<typeof logProcessingEvents>[]> {
  return [{ type: "recordReceived", data: input }];
}
