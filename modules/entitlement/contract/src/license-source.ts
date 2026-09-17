import { moduleApi } from "@langwatch/runtime-composition";
import type { EntitlementSource } from "./provider.ts";

/**
 * Stored, signature-verified license; resolved to a Plan or null.
 * A moduleApi token for mandatory dependency declaration, preventing silent
 * degradation when a process forgets to provide it.
 */
export const ActivatedLicenseSource = moduleApi<EntitlementSource>()("licensing");

/**
 * License source for processes with no database; always returns null.
 * Composition roots pick between this and the Enterprise tier's factory.
 */
export function createAbsentLicenseSource(): EntitlementSource {
  return {
    async resolve() {
      return null;
    },
  };
}
