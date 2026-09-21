import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import { INSTANT_EVAL_REQUEST_TYPE } from "~/server/app-layer/instant-evals/spend/request-type";
import { prisma } from "~/server/db";
import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
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
