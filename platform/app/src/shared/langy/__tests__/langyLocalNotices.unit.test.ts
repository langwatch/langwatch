/**
 * The platform's own notice about the developer's folder, and the one message
 * the panel does not draw (ADR-129, specs/langy/langy-code-access.feature).
 */
import { describe, expect, it } from "vitest";

import {
  isLangyHiddenLocalNotice,
  LANGY_LOCAL_CONNECT_NOTICE,
} from "../langyLocalNotices";

describe("given the platform wrote the connect notice into the conversation", () => {
  describe("when the transcript renders", () => {
    /** @scenario "The connect notice is not drawn as a message" */
    it("hides the notice", () => {
      expect(
        isLangyHiddenLocalNotice({
          role: "user",
          parts: [{ type: "text", text: LANGY_LOCAL_CONNECT_NOTICE }],
        }),
      ).toBe(true);
    });

    /** @scenario "The connect notice is not drawn as a message" */
    it("keeps a message the developer wrote", () => {
      expect(
        isLangyHiddenLocalNotice({
          role: "user",
          parts: [{ type: "text", text: "instrument my traces" }],
        }),
      ).toBe(false);
    });

    it("keeps a reply from Langy that says the same words", () => {
      expect(
        isLangyHiddenLocalNotice({
          role: "assistant",
          parts: [{ type: "text", text: LANGY_LOCAL_CONNECT_NOTICE }],
        }),
      ).toBe(false);
    });

    it("keeps a message that carries anything besides text", () => {
      expect(
        isLangyHiddenLocalNotice({
          role: "user",
          parts: [
            { type: "text", text: LANGY_LOCAL_CONNECT_NOTICE },
            { type: "file", url: "x" },
          ],
        }),
      ).toBe(false);
    });

    it("keeps a message with no parts at all", () => {
      expect(isLangyHiddenLocalNotice({ role: "user", parts: [] })).toBe(false);
    });
  });
});
