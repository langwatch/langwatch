/**
 * What the usage page says about the plan, the month and the seats, from the reads it has.
 * Pure: the screen renders these and decides nothing itself.
 * @see specs/licensing/usage-page.feature
 */
import { PlanTypes, UNLIMITED_MESSAGES } from "@langwatch/enterprise-billing-contract";
import type { UsageCategory, UsageCategoryCount, UsageDay } from "@langwatch/entitlement-contract";
import numeral from "numeral";

import {
  EXCLUDING_VAT,
  formatPrice,
  GROWTH_INCLUDED_EVENTS,
  growthOverageCentsPer100k,
  parseGrowthSeatPlanType,
  type Currency as CurrencyType,
} from "./billing-plans.ts";
import { PricingModel } from "./prisma-types.ts";

const formatCount = (value: number): string => numeral(value).format("0,0");

/** The cap the catalogue writes for "as many as you like". */
const UNLIMITED_SEATS_FROM = 9_999;

/** The plan as the usage page reads it: the fields of an active plan it uses. */
export type UsagePagePlan = {
  type: string;
  name: string;
  free: boolean;
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
  planSource?: "license" | "subscription" | "free";
};

export type PlanStripAction = "upgrade" | "manage";

export type PlanStrip = {
  title: string;
  summary: string;
  action: PlanStripAction;
};

function planTitle(plan: UsagePagePlan): string {
  if (plan.free) return "Free plan";
  if (parseGrowthSeatPlanType(plan.type)) return "Growth plan";
  return /plan$/i.test(plan.name) ? plan.name : `${plan.name} plan`;
}

/** The strip on top: the plan, what it costs or includes, and the one action that moves it on. */
export function planStrip({
  plan,
  currency,
  seatPriceCents,
}: {
  plan: UsagePagePlan;
  currency: CurrencyType;
  /** The Growth seat price for the plan's own interval and currency. */
  seatPriceCents: number;
}): PlanStrip {
  const seats = `${formatCount(plan.maxMembers)} full seat${plan.maxMembers === 1 ? "" : "s"}`;
  if (plan.free) {
    const free = formatPrice({ cents: 0, currency });
    return {
      title: planTitle(plan),
      summary: `${free} · ${formatCount(plan.maxMessagesPerMonth)} events and ${seats} a month`,
      action: "upgrade",
    };
  }
  const growth = parseGrowthSeatPlanType(plan.type);
  if (growth) {
    const period = growth.billingInterval === "annual" ? "/yr" : "/mo";
    const total = formatPrice({
      cents: seatPriceCents * plan.maxMembers,
      currency: growth.currency,
    });
    return {
      title: planTitle(plan),
      summary: `${total}${period} ${EXCLUDING_VAT} · ${seats}`,
      action: "manage",
    };
  }
  return { title: planTitle(plan), summary: seats, action: "manage" };
}

/** What the plan includes: a cap the month fills, or an allowance with a price past it. */
export type MonthAllowance = { kind: "cap"; max: string } | { kind: "overage"; text: string };

/** The events card's headline: the count, what the plan includes, and a meter where it caps. */
export type MonthEvents = {
  count: string;
  allowance: MonthAllowance | null;
  fillRatio: number | null;
  status: "ok" | "warning" | "exceeded";
};

const WARNING_AT = 0.8;

/** The line beside the count: "of 50,000 included", or the overage price. */
export function allowanceText(allowance: MonthAllowance): string {
  return allowance.kind === "cap" ? `of ${allowance.max} included` : allowance.text;
}

export function monthEvents({
  count,
  plan,
  pricingModel,
  currency,
}: {
  count: number;
  plan: UsagePagePlan;
  pricingModel: PricingModel | null | undefined;
  currency: CurrencyType;
}): MonthEvents {
  const formatted = formatCount(count);
  const uncapped = { count: formatted, allowance: null, fillRatio: null, status: "ok" } as const;
  // An account-managed plan's terms live in its contract, not the catalogue.
  if (plan.type === PlanTypes.ENTERPRISE) return uncapped;
  const isSeatEventPaid =
    !plan.free && plan.planSource !== "license" && pricingModel === PricingModel.SEAT_EVENT;
  if (isSeatEventPaid) {
    if (!parseGrowthSeatPlanType(plan.type)) return uncapped;
    const overage = formatPrice({ cents: growthOverageCentsPer100k(currency), currency });
    const text = `${formatCount(GROWTH_INCLUDED_EVENTS)} included, then ${overage} per 100,000`;
    return { ...uncapped, allowance: { kind: "overage", text } };
  }
  const max = plan.maxMessagesPerMonth;
  if (max <= 0 || max >= UNLIMITED_MESSAGES) return uncapped;
  const ratio = count / max;
  let status: MonthEvents["status"] = "ok";
  if (ratio >= 1) status = "exceeded";
  else if (ratio >= WARNING_AT) status = "warning";
  return {
    count: formatted,
    allowance: { kind: "cap", max: formatCount(max) },
    fillRatio: Math.min(1, ratio),
    status,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-12-01` as "1 Dec". */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day ?? ""} ${MONTHS[(month ?? 1) - 1] ?? ""}`;
}

/** The chart's three axis labels: the first day, the fifteenth and the last. */
export function chartAxis(days: readonly UsageDay[]): string[] {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return [];
  return [shortDate(first.date), shortDate(days[14]?.date ?? first.date), shortDate(last.date)];
}

/** One bar per day, titled for hover: "3 Nov: 4,800 events". */
export function dailyBars({
  days,
  unit,
}: {
  days: readonly UsageDay[];
  unit: string;
}): { value: number; title: string }[] {
  return days.map((day) => ({
    value: day.count,
    title: `${shortDate(day.date)}: ${formatCount(day.count)} ${unit}`,
  }));
}

/** The Lite members row: a count on plans that have Lite seats, a note on Free, none otherwise. */
export type LiteRow =
  | { kind: "on-growth" }
  | { kind: "count"; value: string; note: string | null }
  | { kind: "none" };

export function liteRow({
  plan,
  pricingModel,
  liteCount,
}: {
  plan: UsagePagePlan;
  pricingModel: PricingModel | null | undefined;
  liteCount: number;
}): LiteRow {
  if (plan.free) return { kind: "on-growth" };
  const hasLiteSeats = plan.maxMembersLite > 0 && pricingModel === PricingModel.SEAT_EVENT;
  if (!hasLiteSeats) return { kind: "none" };
  if (plan.maxMembersLite >= UNLIMITED_SEATS_FROM) {
    return { kind: "count", value: formatCount(liteCount), note: "unlimited" };
  }
  return {
    kind: "count",
    value: `${formatCount(liteCount)} / ${formatCount(plan.maxMembersLite)}`,
    note: null,
  };
}

/** Full seats in use against the plan's. */
export function fullSeats({ used, plan }: { used: number; plan: UsagePagePlan }): string {
  if (plan.maxMembers >= UNLIMITED_SEATS_FROM) return formatCount(used);
  return `${formatCount(used)} / ${formatCount(plan.maxMembers)}`;
}

/** Each project's share of the month's total, for the bar beside its count. */
export function projectShares(projects: readonly { count: number }[]): number[] {
  const total = projects.reduce((sum, project) => sum + project.count, 0);
  return projects.map((project) => (total > 0 ? project.count / total : 0));
}

/** Names the parts of the month breakdown that failed, or null when all loaded. */
export function breakdownGapMessage({
  isError,
  isDailyUnavailable,
  isByCategoryUnavailable = false,
  isProjectsUnavailable,
}: {
  isError: boolean;
  isDailyUnavailable: boolean;
  isByCategoryUnavailable?: boolean;
  isProjectsUnavailable: boolean;
}): string | null {
  const retry = "Refresh the page to try again.";
  if (isError) return `The month by day and by project could not be loaded. ${retry}`;
  const failed = [
    isDailyUnavailable ? "by day" : null,
    isByCategoryUnavailable ? "by type" : null,
    isProjectsUnavailable ? "by project" : null,
  ].filter((part): part is string => part !== null);
  if (failed.length === 0) return null;
  const parts =
    failed.length === 1
      ? failed[0]
      : `${failed.slice(0, -1).join(", ")} and ${failed[failed.length - 1]}`;
  return `The month ${parts} could not be loaded. ${retry}`;
}

const CATEGORY_LABELS: Record<UsageCategory, string> = {
  spans: "Spans",
  logs: "Logs",
  metrics: "Metrics",
  evaluations: "Evaluations",
  experiments: "Experiments",
  scenarios: "Scenarios",
};

const CATEGORY_HINTS: Partial<Record<UsageCategory, string>> = {
  metrics: "1 per series per hour",
};

/** One row of the month by type, in the order the breakdown answers. */
export type CategoryRow = {
  category: UsageCategory;
  label: string;
  hint: string | null;
  count: number;
  share: number;
};

export function categoryRows(byCategory: readonly UsageCategoryCount[]): CategoryRow[] {
  const shares = projectShares(byCategory);
  return byCategory.map((entry, index) => ({
    category: entry.category,
    label: CATEGORY_LABELS[entry.category],
    hint: CATEGORY_HINTS[entry.category] ?? null,
    count: entry.count,
    share: shares[index] ?? 0,
  }));
}
