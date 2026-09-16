import type { EntitlementSource, Plan, ResolvePlanInput } from "./provider.ts";

/**
 * Stored, signature-verified license; resolved to a Plan or null. A mandatory
 * dependency, so a process that forgets it is refused rather than degrading.
 *
 * A class token, not `moduleApi`: this is a seam the PROCESS fills. Boot keys
 * module-API ownership by name and lets only `<name>Server` provide that name,
 * so `moduleApi("licensing")` here made the entitlement contract claim the
 * licensing module's own name - which refuses as a duplicate provider the
 * moment both are installed, and one build installs both.
 */
export abstract class ActivatedLicenseSource implements EntitlementSource {
  abstract resolve(input: ResolvePlanInput): Promise<Plan | null>;
}

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
