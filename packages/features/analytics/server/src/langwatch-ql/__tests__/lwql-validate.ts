/**
 * Composes the LangWatchQL validator the way the feature does, with an
 * optional injected front end so a test can drive the walk with a tree the
 * shipped grammar cannot produce.
 */
import type { LangWatchQLParser } from "../../rules/langwatch-ql-parser.rules";
import type { LangWatchQLValidation } from "../../rules/langwatch-ql-validation-shape.rules";
import {
  LangWatchQLValidationService,
  type ValidateLangWatchQLInput,
} from "../../services/langwatch-ql-validation.service";

export function validateLangWatchQL({
  parser,
  ...input
}: ValidateLangWatchQLInput & { readonly parser?: LangWatchQLParser }): LangWatchQLValidation {
  return LangWatchQLValidationService.create({ parser }).validate(input);
}
