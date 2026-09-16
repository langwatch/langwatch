/**
 * The OTTL editor, as the rest of the package composes it — `features/ai-tools`
 * renders the connected editor, and a private feature may only reach
 * another through its entry, which is what this file is.
 */

export { EnterpriseOttlEditor } from "./ui/sections/ottl-editor.connected.tsx";
export { OttlEditor } from "./ui/elements/ottl-editor.tsx";
export {
  GovernanceOttlValidationClient,
  type GovernanceOttlValidationError,
  type GovernanceOttlValidationResult,
} from "./model/governance-ottl-validation-client.ts";
