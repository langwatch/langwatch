/**
 * The per-project choice to keep the previous simulations screens, for the
 * shell's main menu. @see specs/suites/new-simulations-callout.feature
 */
export {
  clearLegacySimulationsPreference,
  isLegacySimulationsPreferred,
  preferLegacySimulations,
  useLegacySimulationsPreference,
} from "../../behavior/suites/use-legacy-simulations-preference.ts";
