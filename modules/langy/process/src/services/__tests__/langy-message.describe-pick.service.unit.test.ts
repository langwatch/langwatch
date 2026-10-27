/**
 * The describe pick on the code access card, as the model reads it: the pick rides the choices
 * path, so its text rendering is what the next turn sees.
 * @see specs/langy/langy-guided-onboarding.feature
 */
import {
  LANGY_CHOICE_SELECTION_PART_TYPE,
  renderLangyChoiceSelectionText,
} from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LangyMessageService } from "../langy-message.service.ts";

const DESCRIBE_LABEL = "I'd rather describe it";

describe("the describe pick as the model reads it", () => {
  describe("given the user picked I'd rather describe it on the code access card", () => {
    /** @scenario "The tool reads the describe pick as words" */
    it("reads the pick as words on the next turn", () => {
      const selection = { blockId: "code-access:call-1", optionIds: ["describe"] };
      const text = renderLangyChoiceSelectionText({
        selection,
        optionLabelById: new Map([
          ["local", "Share local folder"],
          ["github", "Connect to GitHub"],
          ["describe", DESCRIBE_LABEL],
        ]),
      });

      const turnText = LangyMessageService.extractTextFromParts([
        { type: LANGY_CHOICE_SELECTION_PART_TYPE, ...selection },
        { type: "text", text },
      ]);

      expect(turnText).toContain(DESCRIBE_LABEL);
      expect(turnText).not.toContain("code-access:call-1");
    });
  });
});
