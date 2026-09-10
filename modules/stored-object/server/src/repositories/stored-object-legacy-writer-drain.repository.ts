import type { Instant } from "@langwatch/time";

/** Whether every legacy writer has drained past the generation the import needs. */
export abstract class StoredObjectLegacyWriterDrainPort {
  abstract get(input: {
    organizationId: string;
  }): Promise<
    { valid: true; minimumWriterGeneration: string; assertedAt: Instant } | { valid: false }
  >;
}
