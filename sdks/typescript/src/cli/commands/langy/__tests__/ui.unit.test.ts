/**
 * What the terminal shows while a folder is shared.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import { describe, expect, it } from "vitest";
import { conversationLink } from "../ui";

describe("conversationLink", () => {
  describe("when the platform sends an absolute url", () => {
    it("keeps it as it is", () => {
      expect(
        conversationLink({
          url: "https://app.langwatch.ai/?langyConversation=conv_1",
          endpoint: "https://app.langwatch.ai",
        }),
      ).toBe("https://app.langwatch.ai/?langyConversation=conv_1");
    });
  });

  describe("when the platform sends a path", () => {
    it("joins it to the endpoint the CLI already talks to", () => {
      expect(
        conversationLink({
          url: "/?langyConversation=conv_1",
          endpoint: "http://localhost:5570",
        }),
      ).toBe("http://localhost:5570/?langyConversation=conv_1");
    });

    it("keeps the path when there is no endpoint to join it to", () => {
      expect(
        conversationLink({
          url: "/?langyConversation=conv_1",
          endpoint: undefined,
        }),
      ).toBe("/?langyConversation=conv_1");
    });
  });
});
