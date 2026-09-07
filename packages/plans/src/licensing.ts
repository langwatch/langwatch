import { z } from "zod";
import { UNLIMITED } from "./limits.ts";
import type { MoneyByCurrency } from "./plan-type.ts";
import { planSeatsAndVolume } from "./quoted-plan.ts";

// The plan facts a signed licence carries. They live here rather than in the
// licensing feature for the same reason the cloud catalogue does: a template,
// a floor and a resolved plan are three readings of one set of numbers, and a
// second definition of any of them is how two parts of the product come to
// quote a self-hosted customer different seats. See drift.md.

/** The seats a licence sells. `maxMembersLite` predates the split, so it is optional. */
export const licenseSeatsShape = {
  maxMembers: z.number(),
  maxMembersLite: z.number().optional(),
} as const;

/** Whether the plan may publish. Named here so no payload restates it. */
export const planPublishingShape = {
  canPublish: z.boolean(),
} as const;

/** The seats a licence sells, stated from parts. */
export function licenseSeats({
  members,
  membersLite,
}: {
  members: number;
  membersLite: number | undefined;
}): { maxMembers: number; maxMembersLite: number | undefined } {
  return { maxMembers: members, maxMembersLite: membersLite };
}

/** The publishing entitlement, stated from a decision the caller already made. */
export function planPublishing({ publish }: { publish: boolean }): { canPublish: boolean } {
  return { canPublish: publish };
}

/** The levers an operator may state when asking for a key to be minted. */
export const generatableLimitsShape = {
  maxMembers: z.number(),
  maxMembersLite: z.number().optional(),
  maxMessagesPerMonth: z.number().optional(),
} as const;

/** Each ceiling beside what the organization is currently using against it. */
export const licenseResourceLimitsShape = {
  currentMembers: z.number(),
  maxMembers: z.number(),
  currentMembersLite: z.number(),
  maxMembersLite: z.number(),
  currentMessagesPerMonth: z.number(),
  maxMessagesPerMonth: z.number(),
} as const;

/**
 * Plan limits a minted license encodes: the enforced levers (member seats,
 * messages volume) plus identity. Projects, teams and experimentation
 * resources are OSS/uncapped and are not part of a license.
 */
export const mintablePlanLimitsSchema = z.object({
  maxMembers: z.number().int().positive("Plan limits must be positive numbers"),
  maxMembersLite: z.number().int().positive("Plan limits must be positive numbers"),
  maxMessagesPerMonth: z.number().int().positive("Plan limits must be positive numbers"),
  canPublish: z.boolean(),
  webhookEndpointsEnabled: z.boolean().optional(),
  usageUnit: z.enum(["traces", "events"]),
});

export type LicenseResourceCounts = {
  currentMembers: number;
  maxMembers: number;
  currentMembersLite: number;
  maxMembersLite: number;
  currentMessagesPerMonth: number;
  maxMessagesPerMonth: number;
};

/** Each ceiling paired with the count measured against it, in reading order. */
export function licenseResourceCounts({
  members,
  membersLite,
  messagesPerMonth,
}: {
  members: { current: number; max: number };
  membersLite: { current: number; max: number };
  messagesPerMonth: { current: number; max: number };
}): LicenseResourceCounts {
  return {
    currentMembers: members.current,
    maxMembers: members.max,
    currentMembersLite: membersLite.current,
    maxMembersLite: membersLite.max,
    currentMessagesPerMonth: messagesPerMonth.current,
    maxMessagesPerMonth: messagesPerMonth.max,
  };
}

/**
 * A plan as a licence states it. `maxMembers` is absent from the template a
 * self-serve purchase uses, because the seat count comes from what was bought.
 */
export type LicensePlanTemplate = {
  type: string;
  name: string;
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
  canPublish: boolean;
  webhookEndpointsEnabled?: boolean;
  usageUnit: string;
};

// Templates carry only what a licence encodes now: seats, volume and
// identity. Workspace structure and experimentation resources are uncapped
// on self-hosted, so they are neither templated nor minted.

/**
 * GROWTH plan template with unlimited limits except maxMembers, which is
 * supplied at generation time from the Stripe seat quantity. Used for
 * self-serving license purchases.
 */
export const GROWTH_TEMPLATE: Omit<LicensePlanTemplate, "maxMembers"> = {
  type: "GROWTH",
  name: "Growth",
  maxMembersLite: UNLIMITED,
  maxMessagesPerMonth: UNLIMITED,
  canPublish: true,
  usageUnit: "events",
};

/** PRO plan template with standard limits. The default for a PRO licence. */
export const PRO_TEMPLATE: LicensePlanTemplate = {
  type: "PRO",
  name: "Pro",
  maxMembers: 10,
  maxMembersLite: 5,
  maxMessagesPerMonth: 100000,
  canPublish: true,
  usageUnit: "traces",
};

/** ENTERPRISE plan template with high limits. The default for an ENTERPRISE licence. */
export const ENTERPRISE_TEMPLATE: LicensePlanTemplate = {
  type: "ENTERPRISE",
  name: "Enterprise",
  maxMembers: 100,
  maxMembersLite: 50,
  maxMessagesPerMonth: 10000000,
  canPublish: true,
  webhookEndpointsEnabled: true,
  usageUnit: "traces",
};

/**
 * The template a plan type mints from, or null for CUSTOM and unknown types.
 * GROWTH answers without `maxMembers`, which generation supplies.
 */
export function getPlanTemplate(
  planType: string,
): LicensePlanTemplate | Omit<LicensePlanTemplate, "maxMembers"> | null {
  switch (planType) {
    case "GROWTH":
      return GROWTH_TEMPLATE;
    case "PRO":
      return PRO_TEMPLATE;
    case "ENTERPRISE":
      return ENTERPRISE_TEMPLATE;
    default:
      return null;
  }
}

/** A template's levers, as the mint form fills them in. */
export function templateFormDefaults(template: LicensePlanTemplate): {
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
  canPublish: boolean;
  webhookEndpointsEnabled: boolean | undefined;
} {
  return {
    ...planSeatsAndVolume({
      members: template.maxMembers,
      membersLite: template.maxMembersLite,
      messagesPerMonth: template.maxMessagesPerMonth,
    }),
    canPublish: template.canPublish,
    webhookEndpointsEnabled: template.webhookEndpointsEnabled,
  };
}

/** A plan resolved from a licence, or from the absence of one. */
export type LicensingQuotedPlan = {
  planSource: "free";
  type: string;
  name: string;
  free: boolean;
  overrideAddingLimitations: boolean;
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
  canPublish: boolean;
  usageUnit: string;
  prices: MoneyByCurrency;
};

/**
 * The plan a self-hosted deployment runs on without a license. A license sells
 * the Enterprise surface and support, not permission to run the software, so
 * nothing the deployment stores on its own infrastructure is capped here.
 */
export const OPEN_SOURCE_LICENSING_PLAN: LicensingQuotedPlan = {
  planSource: "free",
  type: "OPEN_SOURCE",
  name: "Open Source",
  free: true,
  overrideAddingLimitations: true,
  maxMembers: UNLIMITED,
  maxMembersLite: UNLIMITED,
  maxMessagesPerMonth: UNLIMITED,
  canPublish: true,
  usageUnit: "traces",
  prices: { USD: 0, EUR: 0 },
};

/**
 * The cloud free tier as licensing states it. Self-hosted never lands here: it
 * resolves to `OPEN_SOURCE_LICENSING_PLAN`. The visibility window is the
 * caller's. See drift.md: billing states this tier differently.
 */
export const CLOUD_FREE_LICENSING_PLAN: LicensingQuotedPlan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  overrideAddingLimitations: false,
  maxMembers: 1,
  maxMembersLite: 0,
  maxMessagesPerMonth: 1_000,
  canPublish: false,
  usageUnit: "traces",
  prices: { USD: 0, EUR: 0 },
};
