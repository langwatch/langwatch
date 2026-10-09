/**
 * The application's toaster, with the error footer wired in.
 */

import { Toaster } from "@langwatch/design-system/toaster";
import { ErrorActions } from "@langwatch/error-views";

import { readUiErrorActions } from "./ui-error-actions";

export function UiErrorToaster() {
  return (
    <Toaster
      renderMeta={(meta) => {
        const actions = readUiErrorActions(meta);
        return <ErrorActions {...actions} />;
      }}
    />
  );
}
