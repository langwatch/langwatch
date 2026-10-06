/** The dashboards catalogue: the question tree, every widget and every template. */

export { preloadedTemplatesFor, templateWidgetsFor } from "./model/catalogue-boards.ts";
export {
  AGENT_KIND_LABELS,
  AGENT_KINDS,
  PERSONA_LABELS,
  PERSONAS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  TRUNKS,
} from "./model/catalogue-labels.ts";
export type {
  AgentKind,
  CatalogueScope,
  Persona,
  QuestionType,
  Trunk,
} from "./model/catalogue-labels.ts";
export { CATALOGUE_TEMPLATES, type CatalogueTemplate } from "./model/catalogue-templates.ts";
export {
  CATALOGUE_WIDGETS,
  type CatalogueBuild,
  type CatalogueWidget,
} from "./model/catalogue-widgets.ts";
export {
  DATA_REQUIREMENTS,
  type DataRequirement,
  type RequirementKind,
} from "./model/data-requirements.ts";
export { QUESTION_TREE, type TreeQuestion } from "./model/question-tree.ts";
