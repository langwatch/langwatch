/**
 * The From LangWatch boards with their library cards: the catalogue's definitions, joined by
 * template id to what the browser shows for each.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import {
  CURATED_BOARD_DEFINITIONS,
  type CuratedBoardDefinition,
} from "@langwatch/analytics-catalogue";

import { TEMPLATE_LIBRARY, type LibraryTemplate } from "./template-library.ts";

/** What the From LangWatch group is, under its heading's (i); the prototype says the same. */
export const FROM_LANGWATCH_ABOUT =
  "Dashboards LangWatch made for you. They are read-only and improve over time. Duplicate one to " +
  "make a copy you can edit.";

/** One From LangWatch board as the browser shows it: its definition and its library card. */
export interface CuratedBoard extends CuratedBoardDefinition {
  /** Its card in the library, for the empty board's "Or start from a template". */
  readonly card: LibraryTemplate;
}

function withCard(board: CuratedBoardDefinition): CuratedBoard[] {
  const card = TEMPLATE_LIBRARY.find(({ board: { id } }) => id === board.templateId);
  return card ? [{ ...board, card }] : [];
}

/** The From LangWatch boards, in their one order. */
export const CURATED_BOARDS: readonly CuratedBoard[] = CURATED_BOARD_DEFINITIONS.flatMap(withCard);

/** One From LangWatch board by its template id; undefined for any other id. */
export function curatedBoardById(templateId: string): CuratedBoard | undefined {
  return CURATED_BOARDS.find((board) => board.templateId === templateId);
}
