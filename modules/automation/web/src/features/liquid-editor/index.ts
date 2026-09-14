// Public entry point for the Liquid template editor; hides internals so they can move without
// affecting callers (authoring flow and delivery providers).

export {
  clearLiquidMarkers,
  clearModelVariables,
  detectUnknownVariables,
  LIQUID_JSON_LANGUAGE_ID,
  LIQUID_LANGUAGE_ID,
  positionInsideLiquid,
  registerLiquidLanguage,
  setModelVariables,
  setupLiquidJsonSchema,
  validateLiquidModel,
  type MonacoTextModel,
  type UnknownVariable,
  type VariableInfo,
} from "./behavior/liquid-monaco.ts";
export { monacoBackgroundFor, trapEscapeInsideEditor } from "./behavior/monaco-editor-chrome.ts";
export { useMonacoTheme } from "./behavior/use-monaco-theme.ts";
export * from "./model/alert-variables.ts";
export * from "./model/monaco-schemas.ts";
export * from "./model/report-variables.ts";
export { VariableInfoIcon } from "./ui/elements/variable-info-icon.tsx";
