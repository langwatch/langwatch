/**
 * How wide the navigation column is drawn.
 *
 * Moved out of `platform/app/src/components/MainMenu.tsx`, where the two
 * numbers were exported constants three other modules imported. They sit in
 * the model because the shell's own layout math reads them — the content
 * column's width cap is the window less this — and a layout number a component
 * owns is a number the column beside it cannot see.
 */

export const MENU_WIDTH_EXPANDED = "200px";
export const MENU_WIDTH_COMPACT = "56px";

/** The header bar's height, and with it the top edge of every column below. */
export const APP_HEADER_HEIGHT = 56;
