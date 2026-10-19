/**
 * The dashboards catalogue: the question tree, every widget with its code, every template and
 * the From LangWatch boards. Portable and framework-free, so a server reads what the browser draws.
 */

export * from "./catalogue/index.ts";
export * from "./templates/index.ts";
export { BOARD_LWQL_VIEWS } from "./model/board-lwql-views.ts";
export {
  type CatalogueFilters,
  type CatalogueItem,
  type CatalogueSection,
  catalogueSearchText,
  catalogueSections,
  filterCatalogue,
  NO_CATALOGUE_FILTERS,
  type TrunkCounts,
  trunkCounts,
} from "./model/catalogue-filter.ts";
export {
  CURATED_BOARD_DEFINITIONS,
  CURATED_TEMPLATE_IDS,
  type CuratedBoardDefinition,
  curatedBoardDefinitionById,
  type CuratedBoardWidget,
  curatedBoardWidgetById,
  templateWidgetId,
} from "./model/curated-boards.ts";
export type { WidgetQuestion, WidgetQuestionIcon } from "./model/widget-questions.ts";
