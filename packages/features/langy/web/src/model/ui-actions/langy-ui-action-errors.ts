/**
 * What a page refuses a UI action with, when the refusal is the page's own.
 *
 * The browser reports a thrown `code` straight through to the agent
 * (`executeUiAction`), so a class here is the client half of the codes in
 * `server/app-layer/langy/ui-actions/errors.ts`.
 */

/**
 * The page holds a document the server has already replaced, so it cannot
 * write. Autosave stands down in that state by design, which used to mean a
 * browser-executed action applied to the tab, saved nothing, and still answered
 * "done": the agent then built its next step on a document only that tab could
 * see. Refusing names the state instead, and the backend path
 * (`--experiment <slug>`) writes the saved document directly.
 */
export class LangyUiPageOutOfDateError extends Error {
  readonly code = "langy_ui_page_out_of_date";

  constructor() {
    super("The open page holds an older version of this evaluation, so it cannot save the change.");
    this.name = "LangyUiPageOutOfDateError";
  }
}

/**
 * The change was applied to the page but the write to the server did not land,
 * for a reason that is not a newer version: the network dropped, or the server
 * rejected the document. The page keeps the edit and autosave retries it, but
 * the agent must not be told the save happened, because its next step reads
 * the saved document and would read one without the change.
 */
export class LangyUiSaveFailedError extends Error {
  readonly code = "langy_ui_save_failed";

  constructor() {
    super("The open page could not save the change to the server.");
    this.name = "LangyUiSaveFailedError";
  }
}
