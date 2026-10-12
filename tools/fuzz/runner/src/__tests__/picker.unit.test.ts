import { describe, expect, it } from "vitest";

import { isDestructive, pickAction, trailStep, type Candidate } from "../picker.ts";
import { hashSeed, mulberry32 } from "../rng.ts";

const candidates: Candidate[] = [
  { id: 0, kind: "button", tag: "button", text: "Save" },
  { id: 1, kind: "input", tag: "input", text: "Name", inputType: "text" },
  { id: 2, kind: "link", tag: "a", text: "Datasets", href: "/p/datasets" },
  { id: 3, kind: "input", tag: "input", text: "Count", inputType: "number" },
  { id: 4, kind: "close", tag: "button", text: "Close" },
  { id: 5, kind: "button", tag: "button", text: "Sign out" },
];

const trailFor = ({ seed, overlayOpen = false }: { seed: number; overlayOpen?: boolean }) => {
  const rng = mulberry32(hashSeed([seed, "/route", 0]));
  return Array.from({ length: 40 }, (_, n) =>
    trailStep({ n, action: pickAction({ rng, candidates, overlayOpen }), url: "/route" }),
  );
};

describe("pickAction", () => {
  it("gives the same trail for the same seed", () => {
    expect(trailFor({ seed: 7 })).toEqual(trailFor({ seed: 7 }));
    expect(trailFor({ seed: 7, overlayOpen: true })).toEqual(
      trailFor({ seed: 7, overlayOpen: true }),
    );
  });

  it("gives a different trail for another seed", () => {
    expect(trailFor({ seed: 7 })).not.toEqual(trailFor({ seed: 8 }));
  });

  it("never picks sign-out, whatever the seed", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(JSON.stringify(trailFor({ seed }))).not.toMatch(/Sign out/);
    }
  });

  it("uses every kind of action across a run", () => {
    const kinds = new Set(trailFor({ seed: 3 }).map((step) => step.action));
    expect(kinds).toEqual(new Set(["click", "fill", "link"]));
  });

  it("closes an open overlay with escape or a close control, never a page control", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      trailFor({ seed, overlayOpen: true })
        .slice(0, 5)
        .forEach((step) => kinds.add(step.action));
    }
    expect(kinds.has("escape")).toBe(true);
    expect(kinds.has("close")).toBe(true);
  });

  it("only gives a numeric field a number", () => {
    const rng = mulberry32(1);
    const number = [candidates[3] as Candidate];
    const fills = Array.from({ length: 100 }, () =>
      pickAction({ rng, candidates: number, overlayOpen: false }),
    ).flatMap((action) => (action.kind === "fill" ? [action.value.value] : []));
    expect(fills.length).toBeGreaterThan(10);
    expect(fills.filter((value) => Number.isNaN(Number(value)))).toEqual([]);
  });

  it("escapes when the page offers nothing", () => {
    expect(pickAction({ rng: mulberry32(1), candidates: [], overlayOpen: false })).toEqual({
      kind: "escape",
    });
  });
});

describe("isDestructive", () => {
  it.each([
    ["Sign out"],
    ["Log out"],
    ["Delete organization"],
    ["Leave the organisation"],
    ["Remove myself"],
  ])("refuses %s", (text) => {
    expect(isDestructive({ candidate: { text } })).toBe(true);
  });

  it("refuses a sign-out link by address, and a plan's own pattern", () => {
    expect(isDestructive({ candidate: { text: "Go", href: "/api/auth/signout" } })).toBe(true);
    expect(isDestructive({ candidate: { text: "Delete dataset" }, extra: [/delete/i] })).toBe(true);
  });

  it("allows an ordinary control, and a leave that is not the organisation", () => {
    expect(isDestructive({ candidate: { text: "Leave feedback" } })).toBe(false);
    expect(isDestructive({ candidate: { text: "Save" } })).toBe(false);
  });
});
