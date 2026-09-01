/**
 * The Liquid template editor, as the rest of this package composes it.
 *
 * A private feature's public entry: everything another feature in this package
 * may name, and nothing else. The authoring flow is the one caller — its
 * delivery providers each embed an editor for their own template — and it
 * reaches this list rather than the modules behind it, so the editor's internals
 * can move without a search across the package.
 */

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
} from "./behavior/liquid-monaco";
export { monacoBackgroundFor, trapEscapeInsideEditor } from "./behavior/monaco-editor-chrome";
export { useMonacoTheme } from "./behavior/use-monaco-theme";
export * from "./model/alert-variables";
export * from "./model/monaco-schemas";
export * from "./model/report-variables";
export { VariableInfoIcon } from "./ui/elements/variable-info-icon";
