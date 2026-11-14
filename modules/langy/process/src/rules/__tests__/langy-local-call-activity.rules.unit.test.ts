/**
 * The line the panel shows while a call runs on the developer's machine.
 * @see specs/langy/langy-local-control.feature
 */
import type { LocalToolCall } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { callActivityLine } from "../langy-local-call-activity.rules.ts";

const command: LocalToolCall = {
  tool: "local_bash",
  params: {
    command: "uv run --with langwatch python -c 'import langwatch; print(langwatch.__version__)'",
  },
};
const edit: LocalToolCall = {
  tool: "local_edit",
  params: { path: "app/main.py", edits: [{ oldText: "a", newText: "b" }] },
};

describe("callActivityLine", () => {
  describe("given a command on a machine whose owner has a name on record", () => {
    /** @scenario "The activity line says whose machine, never the command" */
    it("names the person by their first name", () => {
      expect(
        callActivityLine({ call: command, personName: "Ada Lovelace", hostname: "ada-mbp" }),
      ).toBe("Running on Ada's machine");
    });

    /** @scenario "The activity line says whose machine, never the command" */
    it("never repeats the command, which stays on the card", () => {
      const line = callActivityLine({
        call: command,
        personName: "Ada Lovelace",
        hostname: "ada-mbp",
      });
      expect(line).not.toContain("uv");
      expect(line).not.toContain("python");
    });

    it("says whose machine an edit happens on too", () => {
      expect(
        callActivityLine({ call: edit, personName: "Ada Lovelace", hostname: "ada-mbp" }),
      ).toBe("Editing on Ada's machine");
    });
  });

  describe("given no name on record", () => {
    /** @scenario "The activity line says whose machine, never the command" */
    it("names the machine instead", () => {
      expect(callActivityLine({ call: command, personName: null, hostname: "ada-mbp" })).toBe(
        "Running on ada-mbp",
      );
    });

    it("treats a blank name as no name", () => {
      expect(callActivityLine({ call: command, personName: "   ", hostname: "ada-mbp" })).toBe(
        "Running on ada-mbp",
      );
    });

    it("says your machine when the folder's machine is unknown too", () => {
      expect(callActivityLine({ call: command, personName: null, hostname: null })).toBe(
        "Running on your machine",
      );
    });
  });
});
