/**
 * The governance sample-data kit: one decision, one toggle, one banner.
 *
 * A governance page turns its own reads into a `RealDataState`, hands that to
 * `useSampleMode`, renders `SampleDataToggle` in the page header and
 * `SampleDataBanner` directly under it while `active`. Everything a page has
 * to decide for itself — which reads count, which panels are invented — stays
 * on the page; the rule does not, and neither does the reader's own answer:
 * one toggle press governs all six governance screens.
 *
 * This is a barrel over a directory, not a re-export of code that lives
 * elsewhere: the modules behind it have no other home.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export { SampleDataBanner, SampleDataToggle } from "./SampleDataControls";
export {
  type RealDataState,
  readSampleChoice,
  resolveRealDataState,
  SAMPLE_CHOICE_KEY,
  type SampleMode,
  sampleModeActive,
  settleRealDataState,
  subscribeToSampleChoice,
  useSampleMode,
  useSettledRealDataState,
  writeSampleChoice,
} from "./sampleMode";
