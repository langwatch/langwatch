import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import { INSTANT_EVAL_REQUEST_TYPE } from "~/server/app-layer/instant-evals/spend/request-type";
import { prisma } from "~/server/db";
import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { createContractBudgetService } from "../../licensing/connect/connect.prisma";
import { billingMonthDateRange } from "./billableEventsQuery";

const logger = createLogger("langwatch:billing:instantEvalSpendQuery");

/**
 * The unit the Instant Evals meter is checkpointed in: ten-thousandths of a
 * dollar, so the running total is an integer and the value Stripe receives is
 * the dollar figure to four places, exactly.
 */
export const INSTANT_EVAL_METER_UNITS_PER_USD = 10_000;

const NANO_USD_PER_METER_UNIT =
  NANO_USD_PER_USD / INSTANT_EVAL_METER_UNITS_PER_USD;

/** Nano-USD to meter units, truncated: a fraction of a unit is never billed. */
export function nanoUsdToInstantEvalMeterUnits(nanoUsd: number): number {
  return Math.floor(nanoUsd / NANO_USD_PER_METER_UNIT);
}

/** Meter units to the dollar value the meter event carries. */
export function instantEvalMeterUnitsToUsd(units: number): number {
  return Number((units / INSTANT_EVAL_METER_UNITS_PER_USD).toFixed(4));
}

const METER_UNITS_PER_USD_CENT = INSTANT_EVAL_METER_UNITS_PER_USD / 100;

/** A contract amount in USD cents, in the meter's own unit. */
export function usdCentsToInstantEvalMeterUnits(cents: number): number {
  return Math.round(cents * METER_UNITS_PER_USD_CENT);
}

/**
 * The organization's Instant Eval spend for a billing month, in meter units.
 *
 * Read off `gateway_spend` across every project of the organization, since
 * the ledger's tenant is the project the judgement ran in. Null when the
 * ledger is not available, which the caller treats as "not now" rather than
 * as zero.
 */
export async function queryInstantEvalSpendTotal({
  organizationId,
  billingMonth,
}: {
  organizationId: string;
  billingMonth: string;
}): Promise<number | null> {
  const spendEvents = getApp().gateway.spendEvents;
  if (!spendEvents) {
    logger.warn(
      { organizationId },
      "ClickHouse not available, skipping Instant Eval spend query",
    );
    return null;
  }

  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });
  const [start, end] = billingMonthDateRange(billingMonth);
  const nanoUsd = await spendEvents.sumCostNanoUsdByRequestType({
    tenantIds: projects.map((project) => project.id),
    requestType: INSTANT_EVAL_REQUEST_TYPE,
    fromMs: Date.parse(`${start.replace(" ", "T")}Z`),
    toMs: Date.parse(`${end.replace(" ", "T")}Z`),
  });
  return nanoUsdToInstantEvalMeterUnits(nanoUsd);
}

/**
 * The most a connected customer's month may report, in meter units
 * (ADR-141, section 7).
 *
 * The gateway stops the customer at its budget on a 60 second refresh, so the
 * ledger can run a few cents past the commit before it does. The credit grant
 * covers the commit and nothing more, so what reaches the meter is capped at
 * the commit, or at the commit plus the overage maximum when overage is on,
 * less what the term's earlier months already carried. Null when the contract
 * cannot be read: an unknown ceiling is not a reason to report nothing.
 */
export async function queryConnectedInstantEvalCeiling({
  organizationId,
  billingMonth,
}: {
  organizationId: string;
  billingMonth: string;
}): Promise<number | null> {
  const terms =
    await createContractBudgetService(prisma).termsOf(organizationId);
  if (terms.termStartsAt === null) return null;
  const ceiling = usdCentsToInstantEvalMeterUnits(
    terms.overageEnabled ? terms.maximumUsdCents : terms.commitUsdCents,
  );

  const spendEvents = getApp().gateway.spendEvents;
  if (!spendEvents) return null;
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });
  const [monthStart] = billingMonthDateRange(billingMonth);
  const earlierNanoUsd = await spendEvents.sumCostNanoUsdByRequestType({
    tenantIds: projects.map((project) => project.id),
    requestType: INSTANT_EVAL_REQUEST_TYPE,
    fromMs: terms.termStartsAt.getTime(),
    toMs: Date.parse(`${monthStart.replace(" ", "T")}Z`),
  });
  const earlier = nanoUsdToInstantEvalMeterUnits(earlierNanoUsd);
  return Math.max(0, ceiling - Math.min(earlier, ceiling));
}
