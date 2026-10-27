/**
 * The one place the app turns an error into something a person can read.
 */

// `ErrorActions` is deliberately absent: the inline surfaces below render it
// themselves; a consumer that wants the row alone imports `@langwatch/error-views`.
export { FormServerError } from "./form-server-error.tsx";
export type { HandledErrorStateProps } from "./handled-error-state.tsx";
export { HandledErrorState } from "./handled-error-state.tsx";
export {
  applyHandledErrorToForm,
  FORM_SERVER_ERROR,
} from "../../../behavior/errors/logic/apply-handled-error-to-form.ts";
export type { AppErrorCode } from "@langwatch/handled-error/app-codes";
export type { ErrorExplanation, ErrorPresentation } from "@langwatch/handled-error/presentation";
export {
  explainAnyError,
  explainHandledError,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/handled-error/presentation";
export type { HandledErrorShape } from "@langwatch/handled-error/read-handled-error";
// No export for rendering a third party's own sentence, deliberately: there is
// no surface that does. A failure we can name resolves to our copy through the
// code-keyed registry; one we cannot resolves to the generic line and a trace
// id. See the note above `isRecord` in `readHandledError`.
export { readHandledError } from "@langwatch/handled-error/read-handled-error";
export type { ResolvedErrorCopy } from "@langwatch/error-views";
export { resolveErrorCopy } from "@langwatch/error-views";
export type { ShowErrorToastOptions } from "../../../behavior/errors/logic/show-error-toast.ts";
export { showErrorToast } from "../../../behavior/errors/logic/show-error-toast.ts";
