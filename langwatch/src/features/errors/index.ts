/**
 * The one place the app turns an error into something a person can read.
 *
 * See `dev/docs/best_practices/error-handling.md` and ADR-045. In short:
 * never render `error.message` — since #5984 it is the error's code slug —
 * read the handled payload and let the code-keyed registry supply the words.
 */
export { HandledErrorAlert } from "./components/HandledErrorAlert";
export type { HandledErrorAlertProps } from "./components/HandledErrorAlert";
export { FormServerError } from "./components/FormServerError";
export { ErrorActions } from "./components/ErrorActions";

export { showErrorToast } from "./logic/showErrorToast";
export type { ShowErrorToastOptions } from "./logic/showErrorToast";
export {
  applyHandledErrorToForm,
  FORM_SERVER_ERROR,
} from "./logic/applyHandledErrorToForm";
export {
  describeError,
  explainHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "./logic/presentation";
export type { ErrorExplanation, ErrorPresentation } from "./logic/presentation";
export { readHandledError, readErrorTraceId } from "./logic/readHandledError";
export type { HandledErrorShape } from "./logic/readHandledError";
export { APP_ERROR_CODES } from "./logic/codes";
export type { AppErrorCode } from "./logic/codes";
