/** The dashboards catalogue: the question tree, every widget and every template. */

export { preloadedTemplatesFor } from "./model/catalogue-boards.ts";
export { GALLERY_TEMPLATES, stackWidgets } from "./model/catalogue-gallery.ts";
export {
  PICKER_QUESTIONS,
  PICKER_SECTIONS,
  type PickerBranch,
  pickerPool,
  type PickerQuestion,
  type PickerSection,
  pickerSections,
  pickerWidgets,
} from "./model/catalogue-picker.ts";
export { CATALOGUE_WIDGET_BUILDS, type CatalogueWidgetBuild } from "./widgets/index.ts";
export { IMPLEMENTED_WIDGET_IDS, implementedWidget } from "./model/widget-implementations.ts";
export {
  AGENT_KIND_CHIP_LABELS,
  AGENT_KIND_FOCUS_LABELS,
  AGENT_KIND_LABELS,
  AGENT_KINDS,
  PERSONA_LABELS,
  PERSONAS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  TRUNK_PITCHES,
  TRUNK_QUESTIONS,
  TRUNKS,
} from "./model/catalogue-labels.ts";
export type {
  AgentKind,
  CatalogueScope,
  Persona,
  QuestionType,
  Trunk,
} from "./model/catalogue-labels.ts";
export {
  CATALOGUE_TEMPLATES,
  type CatalogueTemplate,
  focusTemplateId,
} from "./model/catalogue-templates.ts";
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
export {
  QUESTION_BRANCHES,
  type QuestionBranch,
  QUESTION_TREE,
  type TreeQuestion,
} from "./model/question-tree.ts";
