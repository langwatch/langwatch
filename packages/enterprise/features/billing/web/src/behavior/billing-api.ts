/**
 * The procedures the billing screens call, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process, and
 * the router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `plan`, `limits`, `subscription`,
 * `currency`, `license` and `organization` are mount points on the root router
 * and tRPC hashes that path into the React Query cache key; spell one
 * differently and these hooks stop sharing a cache with the `api.plan.*` and
 * `api.limits.*` call sites that have not moved — the application shell's own
 * plan gate among them.
 *
 * HALF OF THIS MAP IS NOT THIS FEATURE'S, and that costs the package nothing
 * but the strings: `license.*` is the licensing family's and `organization.*`
 * the organization family's, and both are addressed here because the
 * subscription and usage pages read a seat count and a license state on the way
 * to pricing a plan. The analytics family's argument, applied again.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { Plan } from "@langwatch/entitlement-contract";
import type { LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";
import type { Currency } from "../billing-plans";
import type {
  OrganizationUserRole,
  PricingModel,
  TeamUserRole,
} from "../model/prisma-types";

/** The organization every billing procedure is scoped to. */
type OrganizationScope = { organizationId: string };

/**
 * The plan an organization is on.
 *
 * THE PRODUCER'S OWN TYPE, not a restatement: `Plan` is declared in
 * `@langwatch/entitlement-contract` and the plan provider is annotated with it,
 * so a plan field this page reads is a field the producer promises. Its
 * `planSource` is what separates a subscription from a LICENCE, and the
 * subscription page turns on it — a licensed organization is not an upgrade
 * candidate however small the plan it maps to.
 */
export type ActivePlan = Plan;

/**
 * What this organization has used this period, against what it may use.
 *
 * The three counts are what `mapUsageToLimits` reads; `usageUnit` is what
 * decides whether the messages row is labelled traces or events.
 */
export type UsageRead = {
  activePlan: ActivePlan;
  usageUnit?: string;
  membersCount: number;
  membersLiteCount: number;
  currentMonthMessagesCount: number | null;
};

/**
 * One Stripe invoice, as the recent-invoices table renders it.
 *
 * Field for field with `DisplayInvoice`, the projection the subscription
 * service answers with — including `date` as an epoch and the two nullable
 * URLs, because an invoice can be issued before its PDF exists.
 */
export type InvoiceRow = {
  id: string;
  number: string | null;
  date: number;
  amountDue: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
};

/** A member row, as the seat count and the seat drawer read it. */
export type OrganizationMemberRead = {
  userId: string;
  role: OrganizationUserRole;
  user: { id: string; name: string | null; email: string | null };
};

/** An invitation that has not been accepted, which still occupies a seat. */
export type PendingInviteRead = {
  id: string;
  email: string;
  role: OrganizationUserRole;
  status: string;
};

/** Where Stripe wants the reader next. */
type CheckoutRedirect = { url?: string | null };

export type BillingApiMap = {
  plan: {
    getActivePlan: { query: { input: OrganizationScope; output: ActivePlan } };
  };

  limits: {
    getUsage: { query: { input: OrganizationScope; output: UsageRead } };
  };

  license: {
    getStatus: { query: { input: OrganizationScope; output: LicenseStatus } };
  };

  currency: {
    /**
     * Which currency to quote in, from where the request came from.
     *
     * Takes no input and answers one of the two the catalogue prices.
     */
    detectCurrency: { query: { input: Record<string, never>; output: { currency: Currency } } };
  };

  organization: {
    /**
     * The organization graph the application shell already holds.
     *
     * Asked by the FRONTEND FEATURE rather than by a screen — the screens are
     * handed the organization through the host port — and declared here because
     * that feature runs on this package's transport. Same input the shell asks
     * with, so under tRPC's path-plus-input cache key it is the same entry.
     *
     * `pricingModel` is what this family reads off it and no other family does:
     * TIERED and SEAT_EVENT price a seat differently, so it decides whether the
     * usage page draws a ceiling at all.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          pricingModel: PricingModel | null;
          teams: Array<{ id: string; projects: Array<{ id: string }> }>;
        }>;
      };
    };

    getOrganizationWithMembersAndTheirTeams: {
      query: { input: OrganizationScope; output: { members: OrganizationMemberRead[] } };
    };
    getOrganizationPendingInvites: {
      query: { input: OrganizationScope; output: PendingInviteRead[] };
    };
    createInvites: {
      mutation: {
        input: OrganizationScope & {
          invites: Array<{
            email: string;
            role: OrganizationUserRole;
            teams?: Array<{ teamId: string; role: TeamUserRole }>;
          }>;
        };
        output: unknown;
      };
    };
  };

  subscription: {
    listInvoices: { query: { input: OrganizationScope; output: InvoiceRow[] } };

    /** Opens a Stripe checkout for a first subscription. */
    create: {
      mutation: {
        input: OrganizationScope & {
          baseUrl: string;
          plan: string;
          membersToAdd: number;
          currency: Currency;
          billingInterval: string;
        };
        output: CheckoutRedirect;
      };
    };

    /**
     * The same checkout, with the invitations the reader typed carried through.
     *
     * A seat bought and an invitation sent are one act to the customer, and
     * splitting them left people paying for seats they then had to invite into
     * by hand.
     */
    upgradeWithInvites: {
      mutation: {
        input: OrganizationScope & {
          baseUrl: string;
          currency: Currency;
          billingInterval: string;
          totalSeats: number;
          invites: Array<{ email: string; role: "MEMBER" | "EXTERNAL" }>;
        };
        output: CheckoutRedirect;
      };
    };

    /**
     * Changes the seat or event quantity on an existing subscription.
     *
     * `success: false` is a REAL answer and not an error: the non-seat pricing
     * path has no subscription to change, and reporting that as a success told
     * customers a seat count had moved when nothing had.
     */
    addTeamMemberOrEvents: {
      mutation: {
        input: OrganizationScope & {
          plan: string;
          upgradeMembers: boolean;
          upgradeTraces: boolean;
          totalMembers: number;
          totalTraces: number;
          quotedAt?: number;
        };
        output: { success: boolean };
      };
    };

    /** Opens the Stripe billing portal. */
    manage: {
      mutation: { input: OrganizationScope & { baseUrl: string }; output: CheckoutRedirect };
    };
  };
};

/**
 * The billing family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy.
 */
export const billingApi = createFeatureApi<BillingApiMap>();
