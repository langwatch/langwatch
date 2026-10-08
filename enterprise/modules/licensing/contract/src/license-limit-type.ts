/**
 * The limits a refusal names, keyed by the labels and the refusal below: the
 * seats organization checks, and the cloud Free creation caps the owning
 * modules check (entitlement-contract `plan-creation-caps.ts`).
 */
export const limitTypes = [
  "members",
  "membersLite",
  "scenarios",
  "scenarioSets",
  "evaluators",
] as const;

export type LimitType = (typeof limitTypes)[number];
