import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkBody, isDocsPath, main, requiresSection } from "./guard-architecture-section.ts";

const BOT = "dependabot[bot]";
const HUMAN = "0xdeafcafe";

const body = ({
  box = "- [x]",
  look = "None",
  heading = "### Needs a human look",
}: { box?: string; look?: string; heading?: string } = {}): string =>
  [
    "## What changed",
    "A thing.",
    "",
    "## Architecture",
    `${box} I read the sections of \`dev/docs/ARCHITECTURE.md\` this change touches, and it follows them.`,
    "Sections read: §3.4",
    heading,
    "<!-- Anything unusual. Write None if nothing. -->",
    look,
    "",
    "## Acceptance criteria",
    "- [ ] AC 1",
  ].join("\n");

void describe("given the files a pull request changed", () => {
  void describe("when one is code", () => {
    /** @scenario "A PR that changes code needs the Architecture section" */
    void it("requires the section", () => {
      const files = ["docs/intro.md", "modules/trace/process/src/services/a.ts"];
      assert.equal(requiresSection({ files, author: HUMAN }), true);
      assert.equal(requiresSection({ files, author: BOT }), true);
    });

    void it("requires it for an empty change set rather than passing vacuously", () => {
      assert.equal(requiresSection({ files: [], author: HUMAN }), true);
    });
  });

  void describe("when every file is documentation", () => {
    /** @scenario "A PR that changes only documentation is exempt" */
    void it("exempts the public docs site and markdown outside the record", () => {
      const files = [
        "docs/integration/python.mdx",
        "docs/images/a.png",
        "README.md",
        "tools/x/NOTES.md",
      ];
      assert.equal(requiresSection({ files, author: HUMAN }), false);
    });

    /** @scenario "A PR that changes only documentation is exempt" */
    void it("still requires it for the architecture record, ADRs, skills and agent rules", () => {
      for (const path of [
        "dev/docs/ARCHITECTURE.md",
        "dev/docs/adr/001-rbac.md",
        "modules/trace/adrs/003-x.md",
        "enterprise/modules/ops/adrs/001-x.md",
        ".claude/skills/core/repository-rules.md",
        "CLAUDE.md",
      ]) {
        assert.equal(isDocsPath(path), false, path);
        assert.equal(requiresSection({ files: [path], author: HUMAN }), true, path);
      }
    });

    void it("does not read a directory named like a docs file as documentation", () => {
      assert.equal(isDocsPath("documents/a.ts"), false);
      assert.equal(isDocsPath("modules/x/docs/a.ts"), false);
    });
  });

  void describe("when a dependency bot bumps dependencies", () => {
    /** @scenario "A dependency bot's dependency bump is exempt" */
    void it("exempts lockfiles and manifests, but not a human's manifest edit", () => {
      const files = ["package.json", "pnpm-lock.yaml", "services/langevals/uv.lock"];
      assert.equal(requiresSection({ files, author: BOT }), false);
      assert.equal(requiresSection({ files, author: HUMAN }), true);
      assert.equal(requiresSection({ files: ["pnpm-lock.yaml"], author: HUMAN }), false);
    });

    void it("requires it as soon as one file is something else", () => {
      const files = ["package.json", "apps/api/src/main.ts"];
      assert.equal(requiresSection({ files, author: BOT }), true);
    });
  });
});

void describe("given a pull request description", () => {
  void describe("when it has no Architecture heading", () => {
    /** @scenario "A description with no Architecture heading fails" */
    void it("fails and says to add the section", () => {
      const errors = checkBody("## What changed\nA thing.\n### Needs a human look\nNone");
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /No '## Architecture' heading/);
    });

    void it("fails on an empty description, naming both parts", () => {
      assert.equal(checkBody("").length, 2);
    });

    void it("does not accept the heading at a deeper level", () => {
      const errors = checkBody(body().replace("## Architecture", "### Architecture"));
      assert.match(errors[0]!, /No '## Architecture' heading/);
    });
  });

  void describe("when the conformance box is not ticked", () => {
    /** @scenario "An unticked conformance box fails" */
    void it("fails and says to read the sections and tick it", () => {
      const errors = checkBody(body({ box: "- [ ]" }));
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /not ticked/);
    });

    void it("accepts a capital X and an asterisk bullet", () => {
      assert.deepEqual(checkBody(body({ box: "- [X]" })), []);
      assert.deepEqual(checkBody(body({ box: "* [x]" })), []);
    });

    void it("ignores a ticked box that sits outside the Architecture section", () => {
      const text = body({ box: "- [ ]" }).replace("- [ ] AC 1", "- [x] AC 1");
      assert.match(checkBody(text)[0]!, /not ticked/);
    });
  });

  void describe("when 'Needs a human look' is missing or empty", () => {
    /** @scenario "A missing or empty human-look part fails" */
    void it("fails when the heading is absent", () => {
      const text = body().replace("### Needs a human look", "### Notes");
      const errors = checkBody(text);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /No 'Needs a human look' heading/);
    });

    /** @scenario "A missing or empty human-look part fails" */
    void it("fails when nothing but comments and blank lines sit under it", () => {
      const errors = checkBody(body({ look: "   " }));
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /is empty/);
    });

    void it("fails on punctuation alone, so a stray dash is not an answer", () => {
      assert.match(checkBody(body({ look: "-" }))[0]!, /is empty/);
    });

    void it("does not read the next section's text as its content", () => {
      const text = body({ look: "" }).replace("## Acceptance criteria", "## Test plan\nRan it.");
      assert.match(checkBody(text)[0]!, /is empty/);
    });
  });

  void describe("when the section is filled in", () => {
    /** @scenario "A filled-in section passes, and None counts as filled in" */
    void it("passes with 'None'", () => {
      assert.deepEqual(checkBody(body({ look: "None" })), []);
      assert.deepEqual(checkBody(body({ look: "none." })), []);
    });

    /** @scenario "A filled-in section passes, and None counts as filled in" */
    void it("passes with a real note, as H3 or as H2", () => {
      const look = "A new channel in the billing module; please check it against section 3.2.";
      assert.deepEqual(checkBody(body({ look })), []);
      assert.deepEqual(checkBody(body({ look, heading: "## Needs a human look" })), []);
    });

    void it("reads a Windows-edited description with CRLF line endings", () => {
      assert.deepEqual(checkBody(body().replace(/\n/g, "\r\n")), []);
    });

    void it("is not fooled by a ticked box that only exists inside a comment", () => {
      const text = body({ box: "- [ ]" }).replace(
        "Sections read: §3.4",
        "<!-- - [x] ticked in a comment -->",
      );
      assert.match(checkBody(text)[0]!, /not ticked/);
    });

    void it("is not fooled by a section after a comment that never closes", () => {
      const text = ["## What changed", "<!-- hidden from here on", body()].join("\n");
      assert.ok(checkBody(text).length > 0);
    });

    void it("reads a section after a fenced example that shows an unclosed comment", () => {
      const text = ["```html", "<!-- an example", "```", body()].join("\n");
      assert.deepEqual(checkBody(text), []);
    });

    void it("is not fooled by a fence inside a comment", () => {
      const text = ["<!--", "```", "-->", body({ box: "- [ ]" }), "```"].join("\n");
      assert.match(checkBody(text)[0]!, /not ticked/);
    });

    void it("is not fooled by a section that only exists inside a fenced code example", () => {
      const text = ["## What changed", "An example:", "```markdown", body(), "```"].join("\n");
      assert.ok(checkBody(text).length > 0);
    });

    void it("keeps a fence open past a backtick line followed by text", () => {
      const text = ["## What changed", "```markdown", "```not-a-close", body(), "```"].join("\n");
      assert.ok(checkBody(text).length > 0);
    });
  });
});

void describe("given the whole check", () => {
  void describe("when the PR is exempt", () => {
    void it("passes whatever the description says", () => {
      assert.deepEqual(main({ files: ["docs/a.mdx"], author: HUMAN, body: "" }), {
        required: false,
        errors: [],
      });
    });
  });

  void describe("when the PR needs the section", () => {
    void it("reports the description's errors", () => {
      const result = main({ files: ["apps/api/src/main.ts"], author: HUMAN, body: "" });
      assert.equal(result.required, true);
      assert.equal(result.errors.length, 2);
    });
  });
});
