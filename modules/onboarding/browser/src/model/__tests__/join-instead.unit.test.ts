import { describe, expect, it } from "vitest";

import { extractJoinInsteadNames, formatJoinInsteadNames } from "../join-instead.ts";

describe("the join-instead notice's reading of the join lookup", () => {
  it("names nobody when nothing is open to the address", () => {
    expect(extractJoinInsteadNames({ outcome: "none" })).toEqual([]);
    expect(extractJoinInsteadNames(undefined)).toEqual([]);
  });

  it("names every organization the address may ask to join", () => {
    const lookup = {
      outcome: "ask",
      organizations: [
        { organizationId: "org_a", name: "Acme", colleagueCount: 4 },
        { organizationId: "org_b", name: "Beta", colleagueCount: 1 },
      ],
    };

    expect(extractJoinInsteadNames(lookup)).toEqual(["Acme", "Beta"]);
  });

  it("names an automatic match too, because it is still somewhere to go", () => {
    const lookup = {
      outcome: "auto",
      organization: { organizationId: "org_a", name: "Acme", colleagueCount: 4 },
    };

    expect(extractJoinInsteadNames(lookup)).toEqual(["Acme"]);
  });

  it("writes the names the way a person would say them", () => {
    expect(formatJoinInsteadNames(["Acme"])).toBe("Acme");
    expect(formatJoinInsteadNames(["Acme", "Beta"])).toBe("Acme and Beta");
    expect(formatJoinInsteadNames(["Acme", "Beta", "Gamma"])).toBe("Acme, Beta and Gamma");
  });
});
