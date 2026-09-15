/**
 * Composes the LangWatchQL validator the way the feature does, with an
 * optional injected front end so a test can drive the walk with a tree the
 * shipped grammar cannot produce.
 */
import type { LangWatchQLParser } from "../../rules/langwatch-ql-parser.rules.ts";
import type { LangWatchQLValidation } from "../../rules/langwatch-ql-validation-shape.rules.ts";
import {
  LangWatchQLValidationService,
  type ValidateLangWatchQLInput,
} from "../../services/langwatch-ql-validation.service.ts";

export function validateLangWatchQL({
  parser,
  ...input
}: ValidateLangWatchQLInput & { readonly parser?: LangWatchQLParser }): LangWatchQLValidation {
  return LangWatchQLValidationService.create({ parser }).validate(input);
}
