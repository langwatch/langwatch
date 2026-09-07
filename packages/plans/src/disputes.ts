import { z } from "zod";
import { planTypeSchema } from "./plan-type.ts";

/**
 * A fact two definitional sites state differently. The catalogue carries the
 * value billing enforces today and records the other one here, with the line
 * that states it, so nothing is quietly resolved by whoever moved it last.
 */
export const PLAN_DISPUTE_IDS = [
  "automation-ceiling-three-ways",
  "free-plan-two-definitions",
  "growth-copy-volume",
  "pro-volume-below-free",
] as const;

export const planDisputeIdSchema = z.enum(PLAN_DISPUTE_IDS);
export type PlanDisputeId = z.infer<typeof planDisputeIdSchema>;

export const disputedFieldSchema = z.enum([
  "volume",
  "members",
  "membersLite",
  "canPublish",
  "automationDailyDispatch",
]);
export type DisputedField = z.infer<typeof disputedFieldSchema>;

const statedValueSchema = z.object({
  /** What the site says, written the way the site writes it. */
  states: z.string(),
  /** `path:line` of the site, relative to the workspace root. */
  source: z.string(),
});

export const planDisputeSchema = z.object({
  id: planDisputeIdSchema,
  field: disputedFieldSchema,
  /** The plans the dispute lands on. Empty means it lands on the catalogue itself. */
  subjects: z.array(planTypeSchema).readonly(),
  summary: z.string(),
  chosen: statedValueSchema,
  alternatives: z.array(statedValueSchema).readonly(),
});
export type PlanDispute = z.infer<typeof planDisputeSchema>;

/**
 * Counted on feat/strict-feature-layout-v0, 2026-09-07. Alex decides each of
 * these; the catalogue does not resolve one by picking a side quietly.
 */
export const PLAN_DISPUTES: readonly PlanDispute[] = Object.freeze([
  {
    id: "free-plan-two-definitions",
    field: "volume",
    subjects: ["FREE"],
    summary:
      "Two Free plans exist and both are reachable: which answers depends on which source resolves first.",
    chosen: {
      states: "2 members, 0 lite, 50,000 messages per month, publishing allowed",
      source: "packages/plans/src/catalogue-data.ts:115",
    },
    alternatives: [
      {
        states: "1 member, 0 lite, 1,000 messages per month, publishing refused",
        source: "packages/plans/src/licensing.ts:237",
      },
    ],
  },
  {
    id: "pro-volume-below-free",
    field: "volume",
    subjects: ["PRO"],
    summary:
      "Pro is quoted below Free on volume, so the ladder, which sorts rungs by volume, can never place Pro above anything and never offers Free to Pro.",
    chosen: {
      states: "10,000 messages per month, 5 members",
      source: "packages/plans/src/catalogue-data.ts:178",
    },
    alternatives: [
      {
        states: "100,000 messages per month, 10 members",
        source: "packages/plans/src/licensing.ts:136",
      },
      {
        states: "Free is 50,000 messages per month, above Pro",
        source: "packages/plans/src/catalogue-data.ts:125",
      },
    ],
  },
  {
    id: "growth-copy-volume",
    field: "volume",
    subjects: ["GROWTH"],
    summary:
      "The pricing page quotes twice the volume the plan enforces, and nothing compares them.",
    chosen: {
      states: "100,000 messages per month",
      source: "packages/plans/src/catalogue-data.ts:203",
    },
    alternatives: [
      {
        states: "200,000 events included",
        source: "packages/enterprise/features/billing/web/src/model/billing-plans.ts:89",
      },
    ],
  },
  {
    id: "automation-ceiling-three-ways",
    field: "automationDailyDispatch",
    subjects: [],
    summary:
      "The daily automation dispatch ceiling is stated three times: on each plan, as three buckets in the API composition, and with different numbers again in the automation service's own test.",
    chosen: {
      states:
        "per plan: Free 50, Pro 500, Launch 150, Accelerate 300, Growth 500, Enterprise 5,000",
      source: "packages/plans/src/catalogue-data.ts:115",
    },
    alternatives: [
      {
        states: "free 50, paid 500, enterprise 5,000",
        source: "apps/api/src/app/api-automation.composition.ts:80",
      },
      {
        states: "free 100, paid 1,000, enterprise 10,000",
        source:
          "packages/features/automation/server/src/services/__tests__/automation.service.unit.test.ts:293",
      },
    ],
  },
]);
