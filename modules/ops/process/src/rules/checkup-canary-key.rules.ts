/**
 * What the key a checkup canary runs with may do, and nothing more: the routes that canary's
 * probe calls (platform-health subsystem-probe.service.ts). The scenario canary uses its key
 * only to name the project.
 */
export const CANARY_KEY_PERMISSIONS = {
  collector: ["traces:create"],
  processor: ["traces:create", "traces:view"],
  evaluations: ["evaluations:manage"],
  scenarios: ["scenarios:view"],
  langy: ["langy:create"],
} as const satisfies Record<string, readonly string[]>;
