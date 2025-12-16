/**
 * Evaluations V3 Feature
 *
 * New spreadsheet-based evaluation experience.
 */

// Store
export { useEvaluationV3Store, useEvaluationV3Undo } from "./store/useEvaluationV3Store";

// Types
export type {
  EvaluationV3State,
  Agent,
  LLMAgent,
  CodeAgent,
  Evaluator,
  EvaluatorCategory,
  DatasetColumn,
  DatasetRow,
  InlineDataset,
  SavedDataset,
  EvaluationDataset,
  AgentMapping,
  EvaluatorMapping,
  MappingSource,
  EvaluationRun,
  AgentResult,
  EvaluatorResult,
} from "./types";

// Utils
export { stateToDSL, dslToState } from "./utils/dslMapper";

// Hooks
export { useAutosaveV3 } from "./hooks/useAutosaveV3";
export { useRunEvaluationV3 } from "./hooks/useRunEvaluationV3";
export { useEvaluationEventsV3 } from "./hooks/useEvaluationEventsV3";

// Components
export { EvaluationV3Container } from "./components/EvaluationV3Container";
export { EvaluationSpreadsheet } from "./components/spreadsheet/EvaluationSpreadsheet";

