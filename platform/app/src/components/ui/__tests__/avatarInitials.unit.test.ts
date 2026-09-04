/**
 * @vitest-environment node
 *
 * The initials rule the shared avatar replaces the component library's with.
 *
 * It has to match the old one exactly for every name that already worked —
 * this runs on every member list, comment and presence dot in the app — and
 * differ only where the old one returned half a character.
 */
import { describe, expect, it } from "vitest";
import { initialsFromName } from "../avatar";

/** What the component library did, kept here as the thing to agree with. */
function chakraInitials(name: string): string {
  const names = name.trim().split(" ");
  const firstName = names[0] ?? "";
  const lastName = names.length > 1 ? (names[names.length - 1] ?? "") : "";
  return firstName && lastName
    ? `${firstName.charAt(0)}${lastName.charAt(0)}`
    : firstName.charAt(0);
}

describe("given a name written in the basic plane", () => {
  /** @scenario "A two-word name still gives two initials" */
  it("gives the same initials the component library gave", () => {
    for (const name of [
      "John Doe",
      "Ada",
      "Jean-Luc Picard",
      "María del Carmen Rodríguez",
      "  padded  name  ",
    ]) {
      expect(initialsFromName(name)).toBe(chakraInitials(name));
    }
  });

  /** @scenario "A single-word name gives one initial" */
  it("uses one initial for a single word", () => {
    expect(initialsFromName("Ada")).toBe("A");
  });

  /** @scenario "A name of more than two words uses the first and the last" */
  it("uses the first and last word for a longer name", () => {
    expect(initialsFromName("Jan van der Berg")).toBe("JB");
  });
});

describe("given a name beginning outside the basic plane", () => {
  /** @scenario "An emoji outside the basic plane is kept whole" */
  it("keeps the emoji whole, where the library returned half of it", () => {
    expect(initialsFromName("🚩 Langy")).toBe("🚩L");
    // The behaviour being replaced, pinned so the two cannot quietly
    // converge again: charAt(0) here is a lone high surrogate.
    expect(chakraInitials("🚩 Langy")).not.toBe("🚩L");
  });

  /** @scenario "A character written as several code points is kept together" */
  it("keeps a multi-code-point sequence together", () => {
    expect(initialsFromName("🇳🇱 Team")).toBe("🇳🇱T");
    expect(initialsFromName("👨‍👩‍👧 Family")).toBe("👨‍👩‍👧F");
  });

  it("handles an emoji in the last word too", () => {
    expect(initialsFromName("Team 🏭")).toBe("T🏭");
  });
});

describe("given a blank name", () => {
  /** @scenario "A blank name has no initials" */
  it("has no initials, so the avatar can show its generic icon", () => {
    expect(initialsFromName("")).toBe("");
    expect(initialsFromName("   ")).toBe("");
  });
});
