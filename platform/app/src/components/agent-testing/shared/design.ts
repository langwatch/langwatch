/**
 * The greys and the type sizes the Agent Testing surface is drawn with.
 *
 * The surface uses a lighter grey for its faintest text than the shared
 * `fg.muted` token gives, so that value is kept here once and read by every
 * part of the page rather than repeated as a literal.
 */

/** The faintest text and icon colour of the surface. */
export const FG_FAINT = { _light: "gray.400", _dark: "gray.450" } as const;

/** The muted text colour of the surface, one step above faint. */
export const FG_MUTED = { _light: "gray.500", _dark: "gray.400" } as const;

/** The row of column names above a table. */
export const TABLE_HEADER_BG = "bg.muted/50";

/** The row that heads one group of table rows, lighter than the header. */
export const GROUP_HEADER_BG = "bg.muted/30";

/** The background a row takes under the pointer. */
export const ROW_HOVER_BG = "bg.muted/40";
