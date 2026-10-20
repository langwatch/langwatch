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

/** The trace canaries, which run in the hidden checkup project rather than a customer's. */
export const CHECKUP_PROJECT_CANARIES: ReadonlySet<string> = new Set(["collector", "processor"]);

/** What the key a trace canary runs with holds, and how long it lives. */
export const CHECKUP_CANARY_KEY = {
  permissions: ["traces:create", "traces:view"],
  ttlMs: 5 * 60_000,
} as const;
