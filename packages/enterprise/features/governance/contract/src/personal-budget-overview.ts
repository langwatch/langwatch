import { z } from "zod";

export type GovernanceBudgetOverviewInput = {
  organizationId: string;
  userId: string;
  includeTopModels?: boolean;
};

export type GovernanceBudgetOverviewItem = {
  id: string;
  name: string;
  scopeType: string;
  scopeId: string;
  scopeLabel: string;
  window: string;
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  timezone: string | null;
  providerKey: string | null;
  providerLabel: string | null;
  isPerMember: boolean;
  managedByVirtualKeyId: string | null;
  scopeClass: "organization" | "team" | "project" | "personal" | "key" | "department" | "other";
  scopePhrase: string;
  resetsAt: string | null;
  topModels?: Array<{ model: string; spentUsd: number }>;
};

export type GovernanceBudgetOverviewForUser = {
  gatewayAccess: boolean;
  reason?: "flag_off" | "no_membership";
  budgets: GovernanceBudgetOverviewItem[];
};

/**
 * One budget on the /me overview, labelled with the scope it binds. The three
 * money fields are decimal STRINGS: they are read straight off the ledger and
 * never rounded through a float on the way to a screen.
 */
export const governanceBudgetOverviewItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scopeType: z.string(),
    scopeId: z.string(),
    scopeLabel: z.string(),
    window: z.string(),
    limitUsd: z.string(),
    spentUsd: z.string(),
    onBreach: z.string(),
    timezone: z.string().nullable(),
    providerKey: z.string().nullable(),
    providerLabel: z.string().nullable(),
    isPerMember: z.boolean(),
    managedByVirtualKeyId: z.string().nullable(),
    scopeClass: z.enum([
      "organization",
      "team",
      "project",
      "personal",
      "key",
      "department",
      "other",
    ]),
    scopePhrase: z.string(),
    resetsAt: z.string().nullable(),
    topModels: z.array(z.object({ model: z.string(), spentUsd: z.number() }).strict()).optional(),
  })
  .strict();

/**
 * Every budget binding one member's own keys. A caller with no gateway access
 * is answered rather than refused, with the reason, so the screen renders
 * nothing budget-related instead of an error.
 */
export const governanceBudgetOverviewForUserSchema = z
  .object({
    gatewayAccess: z.boolean(),
    reason: z.enum(["flag_off", "no_membership"]).optional(),
    budgets: z.array(governanceBudgetOverviewItemSchema),
  })
  .strict();
