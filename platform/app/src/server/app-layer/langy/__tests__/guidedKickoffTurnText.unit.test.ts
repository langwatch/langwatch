/**
 * The guided onboarding kickoff on the model's side: the turn service reads
 * the message through `extractTextFromParts`, so the typed kickoff part is
 * dropped and the brief is the whole of what the model sees.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { describe, expect, it } from "vitest";
import { buildGuidedKickoffParts } from "~/features/guided-onboarding/kickoff";
import { extractTextFromParts } from "../langy-message.service";

describe("the kickoff message as the model reads it", () => {
  describe("given a user message carrying the kickoff part and the brief", () => {
    /** @scenario "The turn text of the kickoff message is the brief alone" */
    it("keeps the brief and nothing of the typed part", () => {
      const [part, brief] = buildGuidedKickoffParts({
        input: {
          path: "llmops",
          paths: ["llmops", "gateway"],
          provider: "OpenAI",
          providerModel: "gpt-5",
          orgName: "ACME",
          firstName: "Ada",
          tourStatus: "completed",
        },
      });

      const text = extractTextFromParts([part, brief]);

      expect(text).toBe(brief.text);
      expect(text).not.toContain("guided-onboarding-kickoff");
      expect(text).not.toContain("tourStatus");
    });
  });
});
