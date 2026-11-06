/**
 * What the usage page says about the plan, the month and the seats, from the reads it has.
 * Pure: the screen renders these and decides nothing itself.
 * @see specs/licensing/usage-page.feature
 */
import { Currency } from "@langwatch/enterprise-billing-contract";
import type { UsageDay } from "@langwatch/entitlement-contract";
import numeral from "numeral";

import {
  formatPrice,
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
    return { title: planTitle(plan), summary: `${total}${period} · ${seats}`, action: "manage" };
  }
  return { title: planTitle(plan), summary: seats, action: "manage" };
}

/** The events card's headline: the count, what the plan includes, and a meter where it caps. */
export type MonthEvents = {
  count: string;
  included: string | null;
  fillRatio: number | null;
  status: "ok" | "warning" | "exceeded";
};

const WARNING_AT = 0.8;

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
  const isSeatEventPaid =
    !plan.free && plan.planSource !== "license" && pricingModel === PricingModel.SEAT_EVENT;
  if (isSeatEventPaid) {
    const overage = formatPrice({ cents: currency === Currency.EUR ? 500 : 600, currency });
    return {
      count: formatted,
      included: `200,000 included, then ${overage} per 100,000`,
      fillRatio: null,
      status: "ok",
    };
  }
  const max = plan.maxMessagesPerMonth;
  if (max <= 0 || max >= 999_999_999) {
    return { count: formatted, included: null, fillRatio: null, status: "ok" };
  }
  const ratio = count / max;
  let status: MonthEvents["status"] = "ok";
  if (ratio >= 1) status = "exceeded";
  else if (ratio >= WARNING_AT) status = "warning";
  return {
    count: formatted,
    included: `of ${formatCount(max)} included`,
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

/** Each day's bar height as a share of the busiest day, 0 for a day with none. */
export function barHeights(days: readonly UsageDay[]): number[] {
  const max = Math.max(0, ...days.map((day) => day.count));
  return days.map((day) => (max > 0 && day.count > 0 ? Math.max(0.04, day.count / max) : 0));
}

/** The Lite members row: a count on plans that have Lite seats, a note on Free, none otherwise. */
export type LiteRow =
  | { kind: "on-growth" }
  | { kind: "count"; value: string; note: string | null }
  | { kind: "none" };

export function liteRow({
  plan,
  pricingModel,
  isSaaS,
  liteCount,
}: {
  plan: UsagePagePlan;
  pricingModel: PricingModel | null | undefined;
  isSaaS: boolean;
  liteCount: number;
}): LiteRow {
  if (isSaaS && plan.free) return { kind: "on-growth" };
  const hasLiteSeats =
    plan.maxMembersLite > 0 &&
    (!isSaaS || plan.planSource === "license" || pricingModel === PricingModel.SEAT_EVENT);
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

/** Each project's share of the busiest one, for the bar beside its count. */
export function projectShares(projects: readonly { count: number }[]): number[] {
  const total = projects.reduce((sum, project) => sum + project.count, 0);
  return projects.map((project) => (total > 0 ? project.count / total : 0));
}
