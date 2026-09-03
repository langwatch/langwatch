/**
 * The one place the app turns an error into something a person can read.
 *
 * See `dev/docs/best_practices/error-handling.md` and ADR-045. In short:
 * never render `error.message` — since #5984 it is the error's code slug —
 * read the handled payload and let the code-keyed registry supply the words.
 */

// `ErrorActions` is deliberately absent: the two inline surfaces below render
// it themselves, and a consumer that wants the row on its own deep-imports
// `../../elements/errors/error-actions`.
export { FormServerError } from "./form-server-error";
export type { HandledErrorAlertProps } from "./handled-error-alert";
export { HandledErrorAlert } from "./handled-error-alert";
export type { HandledErrorStateProps } from "./handled-error-state";
export { HandledErrorState } from "./handled-error-state";
export {
  applyHandledErrorToForm,
  FORM_SERVER_ERROR,
} from "../../../behavior/errors/logic/apply-handled-error-to-form";
export type { AppErrorCode } from "../../../model/errors/codes";
export type { ErrorExplanation, ErrorPresentation } from "../../../behavior/errors/logic/presentation";
export {
  explainAnyError,
  explainHandledError,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "../../../behavior/errors/logic/presentation";
export type { HandledErrorShape } from "../../../behavior/errors/logic/read-handled-error";
// No export for rendering a third party's own sentence, deliberately: there is
// no surface that does. A failure we can name resolves to our copy through the
// code-keyed registry; one we cannot resolves to the generic line and a trace
// id. See the note above `isRecord` in `readHandledError`.
export { readHandledError } from "../../../behavior/errors/logic/read-handled-error";
export type { ResolvedErrorCopy } from "../../../behavior/errors/logic/resolve-error-copy";
export { resolveErrorCopy } from "../../../behavior/errors/logic/resolve-error-copy";
export type { ShowErrorToastOptions } from "../../../behavior/errors/logic/show-error-toast";
export {
  setTraceErrorHost,
  showErrorToast,
} from "../../../behavior/errors/logic/show-error-toast";
