/**
 * The dashboard block library: definitions, the registry and the two
 * components a screen renders.
 */

export {
  type BlockDefinition,
  type BlockSource,
  blockDefinitionSchema,
  fitGranularity,
  periodDelta,
  SOURCE_CALLS_TO_ACTION,
  SOURCE_EXISTENCE_SQL,
} from "./model/block-definition.ts";
export type { BlockPeriod } from "./model/block-format.ts";
export {
  BLOCK_REGISTRY,
  FLIGHT_DECK_BLOCKS,
  findBlock,
  LIBRARY_BLOCKS,
} from "./model/block-registry.ts";
export {
  DashboardBlock,
  type DashboardBlockProps,
  FlightDeckPanels,
  type FlightDeckPanelsProps,
  NotConnected,
} from "./ui/dashboard-block.tsx";
