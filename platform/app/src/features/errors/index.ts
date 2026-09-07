/**
 * The one place the app turns an error into something a person can read.
 *
 * See `dev/docs/best_practices/error-handling.md` and ADR-045. In short:
 * never render `error.message` — since #5984 it is the error's code slug —
 * read the handled payload and let the code-keyed registry supply the words.
 */

// `ErrorActions` is deliberately absent: `components/ui/toaster.tsx` renders
// it, and this barrel re-exports `showErrorToast`, which imports `toaster` —
// so exporting the component here would close an import cycle. Its consumers
// deep-import `./components/ErrorActions` instead.
export { FormServerError } from "./components/FormServerError";
export type { HandledErrorAlertProps } from "./components/HandledErrorAlert";
export { HandledErrorAlert } from "./components/HandledErrorAlert";
export type { HandledErrorStateProps } from "./components/HandledErrorState";
export { HandledErrorState } from "./components/HandledErrorState";
export {
  applyHandledErrorToForm,
  FORM_SERVER_ERROR,
} from "./logic/applyHandledErrorToForm";
export type { AppErrorCode } from "./logic/codes";
export type { ErrorExplanation, ErrorPresentation } from "./logic/presentation";
export {
  explainAnyError,
  explainHandledError,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "./logic/presentation";
export type { HandledErrorShape } from "./logic/readHandledError";
// No export for rendering a third party's own sentence, deliberately: there is
// no surface that does. A failure we can name resolves to our copy through the
// code-keyed registry; one we cannot resolves to the generic line and a trace
// id. See the note above `isRecord` in `readHandledError`.
export { readHandledError } from "./logic/readHandledError";
export type { ResolvedErrorCopy } from "./logic/resolveErrorCopy";
export { describeError, resolveErrorCopy } from "./logic/resolveErrorCopy";
export type { ShowErrorToastOptions } from "./logic/showErrorToast";
export { showErrorToast } from "./logic/showErrorToast";
