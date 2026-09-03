/**
 * The OTTL editor, as the rest of the package composes it.
 *
 * `features/ai-tools`'s template editor renders the connected editor, and a
 * private feature may only reach another one through its entry — which is what
 * this file is.
 */

export { EnterpriseOttlEditor } from "./ui/sections/ottl-editor.connected";
export { OttlEditor } from "./ui/elements/ottl-editor";
export {
  GovernanceOttlValidationClient,
  type GovernanceOttlValidationError,
  type GovernanceOttlValidationResult,
} from "./model/governance-ottl-validation-client";
