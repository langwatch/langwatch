/**
 * The governance filter kit: one chip, one row, one sort control, and the two
 * time choices every page in the section offers.
 *
 * A page renders a single `FilterChipRow` directly under its header holding
 * every filter and the sort chip, each one a `FilterChip` whose menu items come
 * from `~/components/ui/menu`. Nothing here renders a native `<select>`, and
 * `findNativeSelects` is how a page test proves its own page does not either.
 *
 * This is a barrel over a directory, not a re-export of code that lives
 * elsewhere: the modules behind it have no other home.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export { FilterChip, FilterChipRow, SortChip } from "./FilterChip";
export { findNativeSelects } from "./noNativeSelect";
export {
  coerceInterval,
  DEFAULT_TIME_FRAME,
  DEFAULT_TIME_INTERVAL,
  frameSpanDays,
  isIntervalCoarserThanFrame,
  TIME_FRAMES,
  TIME_INTERVALS,
  type TimeFrame,
  type TimeInterval,
  timeFrameLabel,
  timeIntervalLabel,
} from "./timeControls";
