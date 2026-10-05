/**
 * @vitest-environment node
 *
 * The parity matcher ranks tests for an unbound scenario by what the steps name and the
 * test asserts, not by how alike the titles read.
 */

import { describe, expect, it } from "vitest";

import {
  buildIndex,
  levelAbove,
  literalTermsOf,
  ownerRootsOf,
  rankCandidates,
  scenarioSteps,
  stem,
  termsOf,
  testBlocksOf,
  tsvRow,
} from "../src/tools/parity-candidates.ts";

const FEATURE = [
  "@integration",
  "Feature: Connections",
  "",
  "  @unit",
  "  Scenario: Activating twice is refused",
  '    Given a connection in state "ACTIVE"',
  "    When it is activated again",
  '    Then the answer is "sso_connection_invalid_transition"',
  "",
  "  Scenario: Untagged inherits the feature level",
  "    Given anything",
].join("\n");

const OWNED_TEST = [
  "// Spec: specs/identity/sso-activation.feature",
  'describe("guards", () => {',
  '  it("rejects a second go-live", () => {',
  '    const result = guard.activateConnection({ state: "ACTIVE" });',
  '    expect(result.code).toBe("sso_connection_invalid_transition");',
  "  });",
  "",
  '  /** @scenario "Some other scenario" */',
  '  it("activating twice is refused politely", () => {',
  "    render(screen);",
  "  });",
  "});",
].join("\n");

const FOREIGN_TEST = [
  'describe("activation copy", () => {',
  '  it("activating twice is refused", () => {',
  '    expect(copy).toBe("Try again");',
  "  });",
  "});",
].join("\n");

describe("stem", () => {
  it("brings the forms of one verb together", () => {
    expect(new Set(["proves", "proved", "proving", "prove"].map(stem))).toEqual(new Set(["prov"]));
  });
});

describe("termsOf", () => {
  it("splits camelCase and snake_case and keeps the whole identifier", () => {
    const terms = termsOf("organizationConnectionsOf sso_invalid_transition 429 a");

    expect(terms).toContain("organizationconnectionsof");
    expect(terms).toContain("organization");
    expect(terms).toContain("sso_invalid_transition");
    expect(terms).toContain("invalid");
    expect(terms).toContain("429");
    expect(terms).not.toContain("a");
  });
});

describe("literalTermsOf", () => {
  it("treats quoted values, codes and numbers as literals and prose as not", () => {
    const literals = literalTermsOf(
      'Then the status is 429 and the code "slow_down" for every client',
    );

    expect(literals).toContain("429");
    expect(literals).toContain("slow_down");
    expect(literals).not.toContain("client");
  });
});

describe("scenarioSteps and levelAbove", () => {
  it("reads the steps up to the next scenario and the level tag above", () => {
    expect(scenarioSteps({ source: FEATURE, line: 5 })).toEqual([
      'Given a connection in state "ACTIVE"',
      "When it is activated again",
      'Then the answer is "sso_connection_invalid_transition"',
    ]);
    expect(levelAbove({ source: FEATURE, line: 5 })).toBe("unit");
  });

  it("falls back to the feature's own tag", () => {
    expect(levelAbove({ source: FEATURE, line: 10 })).toBe("integration");
  });
});

describe("testBlocksOf", () => {
  it("records the describe path, the bound title and the feature the file names", () => {
    const blocks = testBlocksOf({ file: "modules/identity/x.unit.test.ts", src: OWNED_TEST });

    expect(blocks.map((b) => b.title)).toEqual([
      "rejects a second go-live",
      "activating twice is refused politely",
    ]);
    expect(blocks[0]?.titleTerms.has("guard")).toBe(true);
    expect(blocks[0]?.assertTerms.has("sso_connection_invalid_transition")).toBe(true);
    expect(blocks[1]?.boundTitles).toEqual(["Some other scenario"]);
    expect(blocks[0]?.boundTitles).toEqual([]);
    expect(blocks[0]?.specRefs).toEqual(["sso-activation.feature"]);
  });
});

describe("ownerRootsOf", () => {
  const catalogue = [
    { root: "modules/identity", names: ["identity"] },
    { root: "modules/auth", names: ["auth"] },
  ];

  it("takes a module's own specs folder as its owner", () => {
    expect(ownerRootsOf({ feature: "modules/auth/specs/a.feature", catalogue })).toEqual([
      "modules/auth",
    ]);
  });

  it("maps a top-level specs path to the module its words name", () => {
    expect(ownerRootsOf({ feature: "specs/identity/sso-activation.feature", catalogue })).toEqual([
      "modules/identity",
    ]);
  });
});

describe("rankCandidates", () => {
  const index = buildIndex([
    ...testBlocksOf({ file: "modules/identity/guard.unit.test.ts", src: OWNED_TEST }),
    ...testBlocksOf({ file: "modules/ui/copy.unit.test.ts", src: FOREIGN_TEST }),
  ]);
  const query = {
    feature: "specs/identity/sso-activation.feature",
    title: "Activating twice is refused",
    line: 5,
    level: "unit" as const,
    steps: scenarioSteps({ source: FEATURE, line: 5 }),
  };

  it("ranks the owned test asserting the scenario's code above one whose title matches", () => {
    const ranked = rankCandidates({ query, index, ownerRoots: ["modules/identity"] });

    expect(ranked[0]?.block.title).toBe("rejects a second go-live");
    expect(ranked[0]?.why).toContain("same-module");
    expect(ranked[0]?.why).toContain("names-feature");
  });

  it("writes no candidate when nothing clears the floor", () => {
    const row = tsvRow({
      query: { ...query, title: "Zebra", steps: ["Given a quokka"] },
      candidates: [],
    });

    expect(row.split("\t")).toEqual([query.feature, "5", "Zebra", "unit", "no candidate"]);
  });
});
