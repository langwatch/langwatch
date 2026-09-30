/**
 * The guided onboarding kickoff on the model's side: the turn service reads
 * the message through `extractTextFromParts`, so the typed kickoff part is
 * dropped and the brief is the whole of what the model sees.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { describe, expect, it } from "vitest";
import {
  buildGuidedKickoffParts,
  GUIDED_KICKOFF_CONVERSATION_TITLE,
} from "~/features/guided-onboarding/kickoff";
import { extractTextFromParts } from "../langy-message.service";
import { titleFromFirstUserMessage } from "../langyConversationTitle";

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

describe("the title of the conversation a first message starts", () => {
  describe("given the first user message is the kickoff", () => {
    /** @scenario "The kickoff names its conversation Getting started" */
    it("names the conversation Getting started, never after the brief", () => {
      const parts = buildGuidedKickoffParts({
        input: {
          path: "gateway",
          paths: ["gateway"],
          orgName: "ACME",
          tourStatus: "skipped",
        },
      });

      const title = titleFromFirstUserMessage(parts);

      expect(title).toBe(GUIDED_KICKOFF_CONVERSATION_TITLE);
      expect(title).toBe("Getting started");
      expect(title).not.toContain("kickoff");
    });
  });

  describe("given the first user message is typed text", () => {
    /** @scenario "An ordinary first message still gets its placeholder title" */
    it("derives the placeholder from the text", () => {
      const title = titleFromFirstUserMessage([
        { type: "text", text: "Why did my trace cost so much?" },
      ]);

      expect(title).toBe("Why did my trace cost so much?");
    });

    it("has no title for a message with no text", () => {
      expect(titleFromFirstUserMessage([{ type: "file" }])).toBeNull();
      expect(titleFromFirstUserMessage(undefined)).toBeNull();
    });
  });
});
