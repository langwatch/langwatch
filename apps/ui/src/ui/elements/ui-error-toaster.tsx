/**
 * The application's toaster, with the error footer wired in.
 *
 * The Design System renders the toast; what it cannot know is what a LangWatch
 * failure carries on its `meta`. `BrowserUiFeedback` puts the docs link and the
 * trace id there, and this is the one place that turns them into a row a reader
 * can act on — without which the "unknown" state of ADR-045 would be a calm
 * sentence and no way to quote the failure to support.
 */

import { Toaster } from "@langwatch/design-system/toaster";
import { readUiErrorActions, UiErrorActions } from "./ui-error-actions";

export function UiErrorToaster() {
  return (
    <Toaster
      renderMeta={(meta) => {
        const actions = readUiErrorActions(meta);
        return <UiErrorActions {...actions} />;
      }}
    />
  );
}
