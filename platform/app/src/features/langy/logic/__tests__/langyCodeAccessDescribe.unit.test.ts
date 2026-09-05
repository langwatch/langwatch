/**
 * The describe pick on the code access card, as the model reads it: the pick
 * rides the choices path, so its text rendering is what the next turn sees.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import {
  LANGY_CHOICE_SELECTION_PART_TYPE,
  renderLangyChoiceSelectionText,
} from "@langwatch/langy";
import { describe, expect, it } from "vitest";
import { extractTextFromParts } from "~/server/app-layer/langy/langy-message.service";
import {
  LANGY_CODE_ACCESS_DESCRIBE_LABEL,
  langyCodeAccessChoicesCard,
} from "../../components/derived-cards/LangyCodeAccessCard";

describe("the describe pick as the model reads it", () => {
  describe("given the user picked I'd rather describe it on the code access card", () => {
    /** @scenario "The tool reads the describe pick as words" */
    it("reads the pick as words on the next turn", () => {
      const card = langyCodeAccessChoicesCard("call-1", { offerDescribe: true });
      const selection = { blockId: card.blockId, optionIds: ["describe"] };
      const text = renderLangyChoiceSelectionText({
        selection,
        optionLabelById: new Map(
          card.options.map((option) => [option.id, option.label]),
        ),
      });

      const turnText = extractTextFromParts([
        { type: LANGY_CHOICE_SELECTION_PART_TYPE, ...selection },
        { type: "text", text },
      ]);

      expect(turnText).toContain(LANGY_CODE_ACCESS_DESCRIBE_LABEL);
      expect(turnText).not.toContain("describe\"");
      expect(turnText).not.toContain("code-access:call-1");
    });
  });
});
