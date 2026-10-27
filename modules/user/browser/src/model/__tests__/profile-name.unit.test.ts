import { describe, expect, it } from "vitest";

import { profileNameMaySave, sanitizeProfileName } from "../profile-name.ts";

describe("given a name that is only whitespace", () => {
  describe("when something asks to set it", () => {
    /** @scenario A blank name is refused at the boundary as well */
    it("refuses, leaving nothing to send", () => {
      expect(sanitizeProfileName("   ")).toBeNull();
    });
  });
});

describe("given a name with real content around whitespace", () => {
  describe("when something asks to set it", () => {
    it("keeps only the trimmed name", () => {
      expect(sanitizeProfileName("  Ana Silva  ")).toBe("Ana Silva");
    });
  });
});

describe("given a typed name matching what is saved", () => {
  describe("when Save is asked whether it may run", () => {
    it("refuses, since nothing changed", () => {
      expect(profileNameMaySave({ typed: "Ana", saved: "Ana" })).toBe(false);
    });
  });
});

describe("given a typed name different from what is saved", () => {
  describe("when Save is asked whether it may run", () => {
    it("allows it", () => {
      expect(profileNameMaySave({ typed: "Ana Silva", saved: "Ana" })).toBe(true);
    });
  });
});
