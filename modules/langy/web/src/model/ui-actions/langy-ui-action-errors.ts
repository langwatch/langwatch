/**
 * What a page refuses a UI action with, when the refusal is the page's own.
 */

/**
 * The page holds a document the server has already replaced, so it cannot write.
 */
export class LangyUiPageOutOfDateError extends Error {
  readonly code = "langy_ui_page_out_of_date";

  constructor() {
    super("The open page holds an older version of this evaluation, so it cannot save the change.");
    this.name = "LangyUiPageOutOfDateError";
  }
}

/**
 * The change was applied to the page but the write to the server did not land, for a
 * reason that is not a newer version: the network dropped, or the server rejected the
 * document.
 */
export class LangyUiSaveFailedError extends Error {
  readonly code = "langy_ui_save_failed";

  constructor() {
    super("The open page could not save the change to the server.");
    this.name = "LangyUiSaveFailedError";
  }
}
