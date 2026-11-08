/**
 * The share command the code access card shows.
 * @see specs/langy/langy-code-access.feature
 */
import { SHARE_CONTROL_COMMAND, shareControlCommand } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

describe("shareControlCommand", () => {
  describe("given the asker's email", () => {
    /** @scenario "The waiting card's command names who asked" */
    it("names the asker with --as", () => {
      expect(shareControlCommand({ email: "riley@acme.test" })).toBe(
        "npx langwatch@latest langy --share-control --as riley@acme.test",
      );
    });

    it("quotes an address a shell would split", () => {
      expect(shareControlCommand({ email: "o'neil @acme.test" })).toBe(
        `${SHARE_CONTROL_COMMAND} --as 'o'\\''neil @acme.test'`,
      );
    });
  });

  describe("given no email", () => {
    it("is the bare command", () => {
      expect(shareControlCommand({ email: null })).toBe(SHARE_CONTROL_COMMAND);
      expect(shareControlCommand({ email: "  " })).toBe(SHARE_CONTROL_COMMAND);
    });
  });
});
