/**
 * Height of the bar that tops each pane of a prompt window — the editor's
 * toolbar on the left, the conversation's bar and its reset action on the
 * right.
 *
 * One number, shared, because the two bars sit side by side and each closes
 * with a hairline: at different heights those hairlines read as one rule broken
 * in the middle rather than as the line under the pane headers.
 */
export const PANE_BAR_MIN_HEIGHT = "40px";
