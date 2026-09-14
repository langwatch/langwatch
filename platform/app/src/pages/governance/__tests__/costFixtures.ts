import type { GovernanceCostDayDto } from "@ee/governance/services/governanceCost.service";

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
