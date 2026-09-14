import type {
  GovernanceCostDayDto,
  GovernanceCostSummaryDto,
} from "@ee/governance/services/governanceCost.service";

/**
 * One day of the cost summary's per-day series, typed as the DTO the screen
 * actually receives.
 *
 * The typing is the point. The cost screen's summary fixtures are handed to an
 * untyped api mock, so a day that leaves out a field the panels fold compiles
 * happily: the token chart then folds `undefined` into `(total ?? 0) +
 * undefined` and draws NaN, which every "this panel is not empty" assertion
 * passes straight over. Building days through here makes that omission a type
 * error rather than an invisible chart.
 *
 * The caller states the four fields these tests vary — a day, both money lanes
 * and the metered token count — and may override any of the rest; the
 * defaults are the shape of a quiet, unrevised, fully priced day, so a fixture
 * stays readable.
 */
export const costDay = (
  day: Pick<
    GovernanceCostDayDto,
    "day" | "billedUsd" | "gatewayUsd" | "gatewayTokens"
  > &
    Partial<GovernanceCostDayDto>,
): GovernanceCostDayDto => ({
  billedCellsWithoutAmount: 0,
  gatewayCellsWithoutAmount: 0,
  billedRevisedAt: null,
  billedByCurrency: [],
  billedCurrenciesWithoutUsdAmount: [],
  billedProvisional: false,
  ...day,
});

/**
 * A summary read that answered, carrying the per-day series a test varies.
 *
 * Same reason as `costDay`, one level up: the summary reaches the screen
 * through an untyped api mock, so a missing field is not a call-site type
 * error but a panel folding `undefined` at render time. Every field is stated
 * here, and the totals are a plausible fully priced window, so a test that
 * only cares about the series does not have to invent one.
 */
export const costSummaryAnswer = (
  series: GovernanceCostDayDto[],
): GovernanceCostSummaryDto => ({
  unavailableReason: null,
  providers: [],
  billed: {
    amountUsd: 120,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    currencyTotals: [
      { currencyCode: "USD", amount: 120, cellsWithoutAmount: 0 },
    ],
  },
  gateway: {
    amountUsd: 80.23,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
    currencyTotals: [
      { currencyCode: "USD", amount: 80.23, cellsWithoutAmount: 0 },
    ],
  },
  seats: { status: "awaiting_data" },
  azureBilling: null,
  series,
  windowDays: 30,
  staleSources: null,
  unpricedWindow: null,
});
