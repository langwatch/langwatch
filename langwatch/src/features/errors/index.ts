/**
 * The one place the app turns an error into something a person can read.
 *
 * See `dev/docs/best_practices/error-handling.md` and ADR-045. In short:
 * never render `error.message` — since #5984 it is the error's code slug —
 * read the handled payload and let the code-keyed registry supply the words.
 */

export { ErrorActions } from "./components/ErrorActions";
export { FormServerError } from "./components/FormServerError";
export type { HandledErrorAlertProps } from "./components/HandledErrorAlert";
export { HandledErrorAlert } from "./components/HandledErrorAlert";
export {
  applyHandledErrorToForm,
  FORM_SERVER_ERROR,
} from "./logic/applyHandledErrorToForm";
export type { AppErrorCode } from "./logic/codes";
export { APP_ERROR_CODES } from "./logic/codes";
export type { ErrorExplanation, ErrorPresentation } from "./logic/presentation";
export {
  describeError,
  explainHandledError,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "./logic/presentation";
export type { HandledErrorShape } from "./logic/readHandledError";
export { readErrorTraceId, readHandledError } from "./logic/readHandledError";
export type { ShowErrorToastOptions } from "./logic/showErrorToast";
export { showErrorToast } from "./logic/showErrorToast";
