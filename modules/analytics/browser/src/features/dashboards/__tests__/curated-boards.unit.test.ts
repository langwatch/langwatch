/**
 * The From LangWatch boards each have a library card: the browser keeps every catalogue board.
 * Board content and widget code are tested in the catalogue.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { CURATED_BOARD_DEFINITIONS } from "@langwatch/analytics-catalogue";
import { describe, expect, it } from "vitest";

import { CURATED_BOARDS } from "../model/curated-boards.ts";

describe("the From LangWatch boards", () => {
  describe("given every catalogue board", () => {
    // The server runs daily insights on every catalogue board, so a board the browser drops
    // for want of a card would get insights whose links read as deleted.
    it("gives each one a library card", () => {
      expect(CURATED_BOARDS.map(({ templateId }) => templateId)).toEqual(
        CURATED_BOARD_DEFINITIONS.map(({ templateId }) => templateId),
      );
    });
  });
});
