import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type ChangedFile,
  type ContentReader,
  findDecisionTriggers,
  parseChangedFileEntries,
} from "./architecture-decisions.ts";
import {
  checkBody,
  checkDecisions,
  cites,
  isDocsPath,
  main,
  requiresSection,
} from "./guard-architecture-section.ts";

const BOT = "dependabot[bot]";
const HUMAN = "0xdeafcafe";

const body = ({
  look = "None",
  heading = "### Needs a human look",
  decisions = "None",
}: { look?: string; heading?: string; decisions?: string } = {}): string =>
  [
    "## What changed",
    "A thing.",
    "",
    "## Architecture",
    "### Decisions no check makes",
    "<!-- Ask your human. -->",
    decisions,
    heading,
    "<!-- Anything unusual. Write None if nothing. -->",
    look,
    "",
    "## Acceptance criteria",
    "- [ ] AC 1",
  ].join("\n");

const file = (filename: string, patch?: string, status = "modified"): ChangedFile => ({
  filename,
  status,
  patch,
});

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

    void it("is not fooled by a heading that only exists inside a comment", () => {
      const text = body().replace("## Architecture", "<!-- ## Architecture -->");
      assert.match(checkBody(text)[0]!, /No '## Architecture' heading/);
    });
  });

  void describe("when the section has no checkbox", () => {
    /** @scenario "No conformance checkbox is asked for" */
    void it("passes without one, and an unticked box elsewhere changes nothing", () => {
      assert.deepEqual(checkBody(body()), []);
      assert.ok(body().includes("- [ ] AC 1"));
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
    void it("passes with 'None' or a real note, as H3 or as H2", () => {
      assert.deepEqual(checkBody(body({ look: "none." })), []);
      const look = "A new channel in the billing module; please check it against section 3.2.";
      assert.deepEqual(checkBody(body({ look, heading: "## Needs a human look" })), []);
    });

    void it("reads a Windows-edited description with CRLF line endings", () => {
      assert.deepEqual(checkBody(body().replace(/\n/g, "\r\n")), []);
    });

    void it("is not fooled by a section after a comment that never closes", () => {
      const text = ["## What changed", "<!-- hidden from here on", body()].join("\n");
      assert.ok(checkBody(text).length > 0);
    });

    void it("reads a section after a fenced example that shows an unclosed comment", () => {
      const text = ["```html", "<!-- an example", "```", body()].join("\n");
      assert.deepEqual(checkBody(text), []);
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

const ARCH_PATCH = "@@ -1,2 +1,3 @@\n ## 3\n+A module may own a fifth package (issue #8798).\n end";
const DECIDED =
  "- A fifth package in analytics (dev/docs/ARCHITECTURE.md). Options: a library; dashboard-contract. Human chose: dashboard-contract, it owns boards. Rule: packages/architecture-enforcer/src/policies/boundaries/manifests.ts";

void describe("given the diff of a pull request", () => {
  void describe("when it changes something no check decides", () => {
    /** @scenario "A change no check decides is found in the diff" */
    void it("finds new architecture prose, but not a moved line", () => {
      const found = findDecisionTriggers({
        files: [file("dev/docs/ARCHITECTURE.md", ARCH_PATCH)],
        author: HUMAN,
      });
      assert.deepEqual(
        found.map((t) => t.kind),
        ["architecture-prose"],
      );
      const moved = "@@ -1,2 +1,2 @@\n-A line.\n+A line.";
      assert.deepEqual(
        findDecisionTriggers({ files: [file("dev/docs/ARCHITECTURE.md", moved)], author: HUMAN }),
        [],
      );
    });

    /** @scenario "A change no check decides is found in the diff" */
    void it("treats an unreadable architecture diff as new prose", () => {
      const found = findDecisionTriggers({
        files: [file("dev/docs/ARCHITECTURE.md")],
        author: HUMAN,
      });
      assert.equal(found[0]?.kind, "architecture-prose");
    });

    /** @scenario "A change no check decides is found in the diff" */
    void it("finds suppressions, but not in the rules' own source", () => {
      const patch = "@@ -1 +1,2 @@\n+// oxlint-disable-next-line langwatch/x -- why\n x();";
      const found = findDecisionTriggers({
        files: [
          file("modules/a/process/src/a.ts", patch),
          file("services/nlpgo/a.go", "@@ -1 +1 @@\n+x() //nolint:gosec"),
          file("packages/oxlint-rules/src/rules/x.rule.mjs", patch),
        ],
        author: HUMAN,
      });
      assert.deepEqual(
        found.map((t) => t.path),
        ["modules/a/process/src/a.ts", "services/nlpgo/a.go"],
      );
    });

    /** @scenario "A change no check decides is found in the diff" */
    void it("finds a new package and a new module root", () => {
      const catalogue = '@@ -1 +1,2 @@\n+      "root": "modules/catalogue-new",\n       "id": "x"';
      const found = findDecisionTriggers({
        files: [
          file("modules/analytics/catalogue/package.json", "+{}", "added"),
          file("modules/analytics/browser/package.json", '+  "a": 1'),
          file("modules/catalogue.json", catalogue),
        ],
        author: HUMAN,
      });
      assert.deepEqual(
        found.map((t) => t.kind),
        ["new-package", "new-module"],
      );
    });

    /** @scenario "A change no check decides is found in the diff" */
    void it("finds a rule switched off or deleted and a policy dropped from the gate, not a reorder", () => {
      const config =
        '@@ -1,2 +1,1 @@\n-    "langwatch/no-raw-font-size": "error",\n     "langwatch/x": "error",';
      const switchedOff =
        '@@ -1 +1 @@\n-    "langwatch/no-raw-color": "error",\n+    "langwatch/no-raw-color": "off",';
      const plugin = ".oxlintrc.plugin.jsonc";
      const contents: Record<string, [string, string]> = {
        [plugin]: [
          '{ "rules": { "langwatch/no-raw-color": "error" } }',
          '{ "rules": { "langwatch/no-raw-color": "off" } }',
        ],
        "packages/architecture-enforcer/oxlint.architecture.jsonc": [
          '{ "rules": { "langwatch/no-raw-font-size": "error", "langwatch/x": "error" } }',
          '{ "rules": { "langwatch/x": "error" } }',
        ],
        ".oxlintrc.native.jsonc": [
          '{ "rules": { "langwatch/a": "error" } }',
          '{ "rules": { "langwatch/a": "error" } }',
        ],
        ".github/workflows/langwatch-app-ci.yml": ["", ""],
      };
      const read: ContentReader = ({ path, side }) => contents[path]?.[side === "base" ? 0 : 1];
      const reorder = '@@ -1,2 +1,2 @@\n-    "langwatch/a": "error",\n+    "langwatch/a": "error",';
      const gate =
        "@@ -1 +1 @@\n-          --policies cycles,manifests,feature-layout\n+          --policies cycles,manifests";
      const found = findDecisionTriggers({
        files: [
          file("packages/architecture-enforcer/oxlint.architecture.jsonc", config),
          file(plugin, switchedOff),
          file(".oxlintrc.native.jsonc", reorder),
          file(".github/workflows/langwatch-app-ci.yml", gate),
          file("packages/oxlint-rules/src/rules/no-raw-color.rule.mjs", undefined, "removed"),
        ],
        author: HUMAN,
        read,
      });
      assert.deepEqual(
        found.map((t) => `${t.kind}:${t.detail}`),
        [
          "rule-removed:langwatch/no-raw-font-size",
          "rule-loosened:langwatch/no-raw-color error -> off",
          "policy-dropped:feature-layout",
          "rule-removed:the rule's source is deleted",
        ],
      );
    });

    /** @scenario "Loosening a check is a change no check decides" */
    void it("finds an entry added to a rule's exemption list, not to an ordinary list", () => {
      const exemption =
        '@@ -10,3 +10,4 @@ const LEGACY_PARTIAL = new Set([\n   "specs/a.feature",\n+  "specs/b.feature",\n ]);';
      const ordinary =
        '@@ -10,3 +10,4 @@ const FUNCTION_BOUNDARY = new Set([\n   "FunctionDeclaration",\n+  "ArrowFunctionExpression",\n ]);';
      const found = findDecisionTriggers({
        files: [
          file("packages/architecture-enforcer/src/tools/check-feature-parity.ts", exemption),
          file("packages/oxlint-rules/src/rules/banned-verb-prefix.rule.mjs", ordinary),
        ],
        author: HUMAN,
      });
      assert.deepEqual(
        found.map((t) => `${t.kind}:${t.path}`),
        ["exemption-widened:packages/architecture-enforcer/src/tools/check-feature-parity.ts"],
      );
    });

    /** @scenario "Loosening a check is a change no check decides" */
    void it("does not read a new rule's lists or a finding's `allowed` remedy as an exemption", () => {
      const newRule =
        '@@ -0,0 +1,4 @@\n+const LEGACY_PARTIAL = new Set([\n+  "specs/a.feature",\n+]);\n+export {};';
      const remedy =
        '@@ -10,3 +10,6 @@ function message() {\n   return {\n+    allowed:\n+      "Cite what exists today, or drop the citation.",\n+    allowed: "Use `Button` from the design system.",\n   };';
      const found = findDecisionTriggers({
        files: [
          file("packages/oxlint-rules/src/rules/new-rule.rule.mjs", newRule, "added"),
          file("packages/architecture-enforcer/src/policies/quality/teaching-citations.ts", remedy),
        ],
        author: HUMAN,
      });
      assert.deepEqual(found, []);
    });

    /** @scenario "Loosening a check is a change no check decides" */
    void it("finds a raised or added shrink-only count, but not a lowered one or a new list", () => {
      const raised =
        '@@ -2,3 +2,4 @@\n-    "a.ts": 2,\n+    "a.ts": 3,\n+    "b.ts": 1,\n     "c.ts": 1';
      const lowered = '@@ -2,2 +2,2 @@\n-    "a.ts": 3,\n+    "a.ts": 2,';
      const found = findDecisionTriggers({
        files: [
          file("packages/architecture-enforcer/tests/baselines/raw-colour.json", raised),
          file("packages/architecture-enforcer/tests/baselines/peer-cycles.json", lowered),
          file("packages/architecture-enforcer/tests/baselines/new-rule.json", raised, "added"),
        ],
        author: HUMAN,
      });
      assert.deepEqual(
        found.map((t) => `${t.kind}:${t.detail}`),
        ["ratchet-grown:2 key(s) added or raised: a.ts, b.ts"],
      );
    });

    /** @scenario "Loosening a check is a change no check decides" */
    void it("finds a raised test budget, not a lowered one or an unrelated number", () => {
      const raised =
        "@@ -1,2 +1,2 @@\n-    expect(rss).toBeLessThan(200 * MB);\n+    expect(rss).toBeLessThan(250 * MB);";
      const lowered =
        "@@ -1,2 +1,2 @@\n-    expect(rss).toBeLessThan(250 * MB);\n+    expect(rss).toBeLessThan(200 * MB);";
      const unrelated = '@@ -1,2 +1,2 @@\n-    const id = "row-1";\n+    const id = "row-2";';
      const found = findDecisionTriggers({
        files: [
          file(
            "modules/analytics/process/src/__tests__/dashboard-memory-budget.integration.test.ts",
            raised,
          ),
          file("modules/a/process/src/__tests__/b.unit.test.ts", lowered),
          file("modules/a/process/src/__tests__/c.unit.test.ts", unrelated),
          file("modules/a/process/src/d.ts", raised),
        ],
        author: HUMAN,
      });
      assert.deepEqual(
        found.map((t) => t.kind),
        ["budget-raised"],
      );
    });

    void it("finds nothing in a dependency bot's PR", () => {
      assert.deepEqual(
        findDecisionTriggers({
          files: [file("dev/docs/ARCHITECTURE.md", ARCH_PATCH)],
          author: BOT,
        }),
        [],
      );
    });
  });

  void describe("when no human decision is recorded", () => {
    /** @scenario "A change no check decides fails until a human's decision is recorded" */
    void it("fails, names the change and tells the agent to ask its human", () => {
      const triggers = findDecisionTriggers({
        files: [file("dev/docs/ARCHITECTURE.md", ARCH_PATCH)],
        author: HUMAN,
      });
      for (const decisions of ["None", "", "- none"]) {
        const errors = checkDecisions({ body: body({ decisions }), triggers, changed: new Set() });
        assert.equal(errors.length, 1, decisions);
        assert.match(errors[0]!, /architecture-prose in dev\/docs\/ARCHITECTURE\.md/);
        assert.match(errors[0]!, /Do not decide this yourself\. Stop and ask the human/);
        assert.match(errors[0]!, /options/);
        assert.match(errors[0]!, /add the lint rule or enforcer policy that encodes their answer/);
      }
    });

    /** @scenario "A change no check decides fails until a human's decision is recorded" */
    void it("fails when the heading is missing altogether", () => {
      const triggers = findDecisionTriggers({
        files: [file("dev/docs/ARCHITECTURE.md", ARCH_PATCH)],
        author: HUMAN,
      });
      const text = body().replace("### Decisions no check makes", "### Notes");
      assert.equal(checkDecisions({ body: text, triggers, changed: new Set() }).length, 1);
    });
  });

  void describe("when a decision is recorded", () => {
    const triggers = findDecisionTriggers({
      files: [file("dev/docs/ARCHITECTURE.md", ARCH_PATCH)],
      author: HUMAN,
    });
    const rule = "packages/architecture-enforcer/src/policies/boundaries/manifests.ts";

    /** @scenario "A recorded decision names the options, the human's choice and the rule" */
    void it("fails on a decision without options, choice or rule, naming each", () => {
      const errors = checkDecisions({
        body: body({
          decisions: "- I made a fifth package and said so in dev/docs/ARCHITECTURE.md.",
        }),
        triggers,
        changed: new Set([rule]),
      });
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /'Options:', 'Human chose:', 'Rule:'/);
    });

    /** @scenario "A recorded decision names the options, the human's choice and the rule" */
    void it("fails on a rule this PR does not change, or one that is not a rule", () => {
      for (const changed of [new Set<string>(), new Set([rule.replace("manifests", "x")])]) {
        const errors = checkDecisions({ body: body({ decisions: DECIDED }), triggers, changed });
        assert.match(errors[0]!, /does not add or change/);
      }
      const notARule = DECIDED.replace(rule, "modules/a/process/src/a.ts");
      const errors = checkDecisions({
        body: body({ decisions: notARule }),
        triggers,
        changed: new Set(["modules/a/process/src/a.ts"]),
      });
      assert.match(errors[0]!, /does not add or change/);
    });

    /** @scenario "A recorded decision names the options, the human's choice and the rule" */
    void it("accepts 'none' only with the reason no rule can express it", () => {
      const none = DECIDED.replace(`Rule: ${rule}`, "Rule: none - a naming choice no lint can see");
      assert.deepEqual(
        checkDecisions({ body: body({ decisions: none }), triggers, changed: new Set() }),
        [],
      );
      const bare = DECIDED.replace(`Rule: ${rule}`, "Rule: none");
      assert.match(
        checkDecisions({ body: body({ decisions: bare }), triggers, changed: new Set() })[0]!,
        /why no rule can express it/,
      );
    });

    /** @scenario "A recorded decision with its rule passes" */
    void it("passes with options, the human's choice and a rule this PR changes", () => {
      assert.deepEqual(
        checkDecisions({ body: body({ decisions: DECIDED }), triggers, changed: new Set([rule]) }),
        [],
      );
    });
  });

  void describe("when every change is decided by a check", () => {
    /** @scenario "A change every check decides needs only None" */
    void it("passes with None and fails without the heading", () => {
      assert.deepEqual(checkDecisions({ body: body(), triggers: [], changed: new Set() }), []);
      const text = body().replace("### Decisions no check makes", "### Notes");
      assert.match(
        checkDecisions({ body: text, triggers: [], changed: new Set() })[0]!,
        /No 'Decisions no check makes' heading/,
      );
    });
  });
});

void describe("given the whole check", () => {
  void describe("when the PR is exempt", () => {
    void it("passes whatever the description says", () => {
      assert.deepEqual(main({ files: [file("docs/a.mdx")], author: HUMAN, body: "" }), {
        required: false,
        errors: [],
      });
    });
  });

  void describe("when the PR needs the section", () => {
    void it("reports the description's errors", () => {
      const result = main({ files: [file("apps/api/src/main.ts")], author: HUMAN, body: "" });
      assert.equal(result.required, true);
      assert.equal(result.errors.length, 3);
    });

    void it("fails a PR that adds architecture prose with no decision, as #8815 did", () => {
      const result = main({
        files: [
          file("dev/docs/ARCHITECTURE.md", ARCH_PATCH),
          file("modules/analytics/catalogue/package.json", "+{}", "added"),
        ],
        author: HUMAN,
        body: body(),
      });
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /architecture-prose.*new-package/);
    });
  });
});

/** Contents by side and path; a path missing from a side cannot be read there. */
const reader =
  (sides: { base: Record<string, string>; head: Record<string, string> }): ContentReader =>
  ({ path, side }) =>
    sides[side][path];

const NATIVE = ".oxlintrc.native.jsonc";
const NATIVE_BEFORE = `{
  // the native config
  "categories": { "correctness": "error" },
  "ignorePatterns": ["dist/**"],
  "rules": {
    "langwatch/x": "error",
    "max-params": ["error", { "max": 3 }],
    "langwatch/complexity": ["error", { "max": 15, "minLength": 2 }],
    "langwatch/y": ["error", { "allow": ["a"] }],
    "langwatch/raised": "warn",
  },
  "overrides": [
    {
      "files": ["modules/**"],
      "excludeFiles": ["**/__tests__/**"],
      "rules": { "langwatch/enforced": "error" },
    },
    {
      // the debt register
      "files": ["modules/a/legacy.ts"],
      "rules": { "langwatch/x": "off" },
    },
  ],
}`;
const loosen = (edit: (text: string) => string) =>
  findDecisionTriggers({
    files: [file(NATIVE, "@@ -1 +1 @@\n-x\n+x")],
    author: HUMAN,
    read: reader({ base: { [NATIVE]: NATIVE_BEFORE }, head: { [NATIVE]: edit(NATIVE_BEFORE) } }),
  }).map((t) => `${t.kind}:${t.subject}`);

const CI = ".github/workflows/langwatch-app-ci.yml";
const GATE_JOB = `name: ci
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6
      - name: Architecture lint (blocking)
        if: \${{ !cancelled() }}
        run: >-
          pnpm --filter @langwatch/architecture-enforcer lint --
          --policies cycles,manifests

      - name: After
        run: echo ok
`;
const gate = (after: string, patch = "@@ -1 +1 @@\n-a\n+b") =>
  findDecisionTriggers({
    files: [file(CI, patch)],
    author: HUMAN,
    read: reader({ base: { [CI]: GATE_JOB }, head: { [CI]: after } }),
  }).map((t) => `${t.kind}:${t.subject}:${t.detail}`);

void describe("given a lint config the diff loosens without removing a key", () => {
  void describe("when a rule's severity is lowered", () => {
    /** @scenario "Loosening a lint config without removing a rule is a change no check decides" */
    void it("names each lowered rule, in string, number and array form, and not a raised one", () => {
      const found = loosen((text) =>
        text
          .replace('"langwatch/x": "error"', '"langwatch/x": "warn"')
          .replace('"max-params": ["error"', '"max-params": [0')
          .replace('"langwatch/y": ["error"', '"langwatch/y": ["off"')
          .replace('"correctness": "error"', '"correctness": "warn"')
          .replace('"langwatch/raised": "warn"', '"langwatch/raised": "error"'),
      );
      assert.deepEqual(found.toSorted(), [
        "rule-loosened:category:correctness",
        "rule-loosened:langwatch/x",
        "rule-loosened:langwatch/y",
        "rule-loosened:max-params",
      ]);
    });
  });

  void describe("when an override turns a rule down", () => {
    /** @scenario "Loosening a lint config without removing a rule is a change no check decides" */
    void it("names a new override, a widened one and a glob dropped from an enforcing one", () => {
      assert.deepEqual(
        loosen((text) =>
          text.replace(
            '"overrides": [',
            '"overrides": [\n { "files": ["apps/**"], "rules": { "max-params": "off", "langwatch/new": "error" } },',
          ),
        ),
        ["rule-loosened:max-params"],
      );
      assert.deepEqual(
        loosen((text) =>
          text.replace(
            '"files": ["modules/a/legacy.ts"]',
            '"files": ["modules/a/legacy.ts", "modules/b/**"]',
          ),
        ),
        ["rule-loosened:langwatch/x"],
      );
      assert.deepEqual(
        loosen((text) => text.replace('"files": ["modules/**"]', '"files": ["modules/other/**"]')),
        ["rule-loosened:langwatch/enforced"],
      );
    });

    /** @scenario "Loosening a lint config without removing a rule is a change no check decides" */
    void it("finds nothing when an override only enforces, or a comment and comma move", () => {
      assert.deepEqual(
        loosen((text) =>
          text
            .replace(
              '"overrides": [',
              '"overrides": [\n { "files": ["apps/**"], "rules": { "langwatch/z": "error" } },',
            )
            .replace("// the debt register", "/* moved */"),
        ),
        [],
      );
    });
  });

  void describe("when a path is ignored", () => {
    /** @scenario "Loosening a lint config without removing a rule is a change no check decides" */
    void it("names a new ignore pattern and a new exclusion from an existing override, not a new override's", () => {
      const found = loosen((text) =>
        text
          .replace('"ignorePatterns": ["dist/**"]', '"ignorePatterns": ["dist/**", "modules/x/**"]')
          .replace(
            '"excludeFiles": ["**/__tests__/**"]',
            '"excludeFiles": ["**/__tests__/**", "modules/y/**"]',
          )
          .replace(
            '"overrides": [',
            '"overrides": [\n { "files": ["apps/**"], "excludeFiles": ["apps/z/**"], "rules": { "langwatch/z": "error" } },',
          ),
      );
      assert.deepEqual(found, ["ignore-added:modules/x/**", "ignore-added:modules/y/**"]);
    });
  });

  void describe("when a numeric option is raised", () => {
    /** @scenario "Loosening a lint config without removing a rule is a change no check decides" */
    void it("names a raised max, a lowered min and a widened allow list, not a tightened limit", () => {
      assert.deepEqual(
        loosen((text) => text.replace('"max": 15', '"max": 60')),
        ["rule-loosened:langwatch/complexity"],
      );
      assert.deepEqual(
        loosen((text) => text.replace('"minLength": 2', '"minLength": 1')),
        ["rule-loosened:langwatch/complexity"],
      );
      assert.deepEqual(
        loosen((text) => text.replace('"allow": ["a"]', '"allow": ["a", "b"]')),
        ["rule-loosened:langwatch/y"],
      );
      assert.deepEqual(
        loosen((text) => text.replace('"max": 3', '"max": 2').replace('"max": 15', '"max": 10')),
        [],
      );
    });
  });

  void describe("when the config cannot be read", () => {
    /** @scenario "Loosening a lint config without removing a rule is a change no check decides" */
    void it("treats a config it cannot read or parse as loosened, naming the config", () => {
      const unreadable = findDecisionTriggers({
        files: [file(NATIVE, "@@ -1 +1 @@\n-x\n+x")],
        author: HUMAN,
        read: reader({ base: {}, head: { [NATIVE]: NATIVE_BEFORE } }),
      });
      assert.deepEqual(
        unreadable.map((t) => `${t.kind}:${t.subject}`),
        [`rule-loosened:${NATIVE}`],
      );
      assert.deepEqual(
        loosen(() => "{ not json"),
        [`rule-loosened:${NATIVE}`],
      );
    });
  });
});

void describe("given a diff that removes a ratchet or weakens the gate", () => {
  void describe("when a ratchet test or baseline is deleted or renamed", () => {
    /** @scenario "Removing a ratchet or weakening the gate is a change no check decides" */
    void it("names the old path, and reads a renamed baseline's raised counts", () => {
      const files = parseChangedFileEntries(
        JSON.stringify([
          [
            {
              filename: "packages/architecture-enforcer/tests/raw-colour.ratchet.unit.test.ts",
              status: "removed",
            },
            {
              filename: "packages/architecture-enforcer/tests/baselines/raw-color.json",
              previous_filename: "packages/architecture-enforcer/tests/baselines/raw-colour.json",
              status: "renamed",
              patch: '@@ -2 +2 @@\n-    "a.ts": 2,\n+    "a.ts": 5,',
            },
            {
              filename: "packages/architecture-enforcer/src/policies/boundaries/manifests.ts",
              status: "removed",
            },
          ],
        ]),
      );
      assert.deepEqual(
        findDecisionTriggers({ files, author: HUMAN }).map((t) => `${t.kind}:${t.subject}`),
        [
          "ratchet-removed:packages/architecture-enforcer/tests/raw-colour.ratchet.unit.test.ts",
          "ratchet-removed:packages/architecture-enforcer/tests/baselines/raw-colour.json",
          "ratchet-grown:packages/architecture-enforcer/tests/baselines/raw-color.json",
          "rule-removed:packages/architecture-enforcer/src/policies/boundaries/manifests.ts",
        ],
      );
    });
  });

  void describe("when the gate step is made skippable or removed", () => {
    /** @scenario "Removing a ratchet or weakening the gate is a change no check decides" */
    void it("names the gate step for continue-on-error, a changed if, a job-level if, a softened command and a removal", () => {
      const step = "Architecture lint (blocking)";
      for (const after of [
        GATE_JOB.replace("        run: >-", "        continue-on-error: true\n        run: >-"),
        GATE_JOB.replace("!cancelled()", "github.event_name == 'push'"),
        GATE_JOB.replace("    runs-on:", "    if: false\n    runs-on:"),
        GATE_JOB.replace("--policies cycles,manifests", "--policies cycles,manifests || true"),
        GATE_JOB.replace(/ {6}- name: Architecture lint[\s\S]*?\n\n/, ""),
      ]) {
        const found = gate(after);
        assert.equal(found.length, 1, after);
        assert.match(
          found[0]!,
          new RegExp(`^gate-weakened:${step.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`),
        );
      }
    });

    /** @scenario "Removing a ratchet or weakening the gate is a change no check decides" */
    void it("finds nothing when a policy is added, and treats an unreadable workflow as weakened", () => {
      const added =
        "@@ -1 +1 @@\n-          --policies cycles,manifests\n+          --policies cycles,manifests,x";
      assert.deepEqual(gate(GATE_JOB.replace("cycles,manifests", "cycles,manifests,x"), added), []);
      const unreadable = findDecisionTriggers({
        files: [file(CI, added)],
        author: HUMAN,
        read: reader({ base: {}, head: {} }),
      });
      assert.deepEqual(
        unreadable.map((t) => `${t.kind}:${t.subject}`),
        [
          "gate-weakened:Architecture lint (blocking)",
          "gate-weakened:Architecture policy tests (blocking)",
          "gate-weakened:Oxlint rule tests (blocking)",
        ],
      );
    });
  });
});

const RUNNERS_JOB = GATE_JOB.replace(
  "      - name: After",
  `      - name: Architecture policy tests (blocking)
        if: \${{ !cancelled() }}
        run: |
          pnpm --filter @langwatch/architecture-enforcer typecheck
          pnpm --filter @langwatch/architecture-enforcer test

      - name: Oxlint rule tests (blocking)
        if: \${{ !cancelled() }}
        run: pnpm --filter @langwatch/oxlint-rules test

      - name: After`,
);

void describe("given a diff that changes what runs the ratchets and rule tests", () => {
  void describe("when a test step is made skippable or its command changes", () => {
    /** @scenario "Removing a ratchet or weakening the gate is a change no check decides" */
    void it("names the policy-tests and rule-tests steps", () => {
      const found = findDecisionTriggers({
        files: [file(CI, "@@ -1 +1 @@\n-a\n+b")],
        author: HUMAN,
        read: reader({
          base: { [CI]: RUNNERS_JOB },
          head: {
            [CI]: RUNNERS_JOB.replace(
              "          pnpm --filter @langwatch/architecture-enforcer typecheck\n",
              "          pnpm --filter @langwatch/architecture-enforcer typecheck\n        continue-on-error: true\n",
            ).replace("oxlint-rules test", "oxlint-rules test -- tests/one.test.mjs"),
          },
        }),
      });
      assert.deepEqual(
        found.map((t) => `${t.kind}:${t.subject}`),
        [
          "gate-weakened:Architecture policy tests (blocking)",
          "gate-weakened:Oxlint rule tests (blocking)",
        ],
      );
    });
  });

  void describe("when a test package's test script or vitest config changes", () => {
    const manifest = "packages/oxlint-rules/package.json";
    const scripts = (test: string, build = "tsc") =>
      JSON.stringify({ name: "x", scripts: { build, test } });

    /** @scenario "Removing a ratchet or weakening the gate is a change no check decides" */
    void it("names a changed test script and an added, changed or removed vitest config", () => {
      const found = findDecisionTriggers({
        files: [
          file(manifest, "@@ -1 +1 @@\n-a\n+b"),
          file("packages/architecture-enforcer/vitest.config.ts", "@@ -1 +1 @@\n-a\n+b"),
          file("packages/oxlint-rules/vitest.ratchets.config.mts", "+x", "added"),
          file("packages/architecture-enforcer/tests/vitest.config.ts", undefined, "removed"),
        ],
        author: HUMAN,
        read: reader({
          base: { [manifest]: scripts("vitest run") },
          head: { [manifest]: scripts("vitest run tests/rules") },
        }),
      });
      assert.deepEqual(
        found.map((t) => `${t.kind}:${t.subject}`).toSorted(),
        [
          `test-gate-changed:${manifest}`,
          "test-gate-changed:packages/architecture-enforcer/vitest.config.ts",
          "test-gate-changed:packages/oxlint-rules/vitest.ratchets.config.mts",
          "ratchet-removed:packages/architecture-enforcer/tests/vitest.config.ts",
          "test-gate-changed:packages/architecture-enforcer/tests/vitest.config.ts",
        ].toSorted(),
      );
    });

    /** @scenario "Removing a ratchet or weakening the gate is a change no check decides" */
    void it("finds nothing for another script, or a vitest config in another package", () => {
      const found = findDecisionTriggers({
        files: [
          file(manifest, "@@ -1 +1 @@\n-a\n+b"),
          file("modules/trace/process/vitest.config.ts", "@@ -1 +1 @@\n-a\n+b"),
        ],
        author: HUMAN,
        read: reader({
          base: { [manifest]: scripts("vitest run") },
          head: { [manifest]: scripts("vitest run", "tsc -b") },
        }),
      });
      assert.deepEqual(found, []);
    });
  });
});

void describe("given several changes no check decides", () => {
  const triggers = findDecisionTriggers({
    files: [file(NATIVE, "@@ -1 +1 @@\n-x\n+x"), file("dev/docs/ARCHITECTURE.md", ARCH_PATCH)],
    author: HUMAN,
    read: reader({
      base: { [NATIVE]: NATIVE_BEFORE },
      head: {
        [NATIVE]: NATIVE_BEFORE.replace('"langwatch/x": "error"', '"langwatch/x": "warn"').replace(
          '"max": 15',
          '"max": 60',
        ),
      },
    }),
  });
  const rule = "packages/oxlint-rules/src/rules/x.rule.mjs";
  const decision = (subject: string, ruleField = rule) =>
    `- Loosen ${subject}. Options: keep; loosen. Human chose: loosen, it misfired. Rule: ${ruleField}`;

  void describe("when the decisions name only some of their subjects", () => {
    /** @scenario "Every change no check decides is named by a recorded decision" */
    void it("fails, listing each change whose subject no decision names", () => {
      const errors = checkDecisions({
        body: body({ decisions: decision("`langwatch/x`") }),
        triggers,
        changed: new Set([rule]),
      });
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /No recorded decision names/);
      assert.match(errors[0]!, /`langwatch\/complexity`/);
      assert.match(errors[0]!, /`dev\/docs\/ARCHITECTURE\.md`/);
      assert.doesNotMatch(errors[0]!, /`langwatch\/x`/);
    });
  });

  void describe("when the decisions name every subject", () => {
    /** @scenario "Every change no check decides is named by a recorded decision" */
    void it("passes, with several subjects in one decision, in backticks or plain", () => {
      const decisions = [
        decision("`langwatch/x` and langwatch/complexity"),
        decision("the record, dev/docs/ARCHITECTURE.md"),
      ].join("\n");
      assert.deepEqual(
        checkDecisions({ body: body({ decisions }), triggers, changed: new Set([rule]) }),
        [],
      );
    });

    void it("matches a whole subject, not a longer name that contains it", () => {
      assert.equal(cites({ entry: "Drop `cycles` from the gate.", subject: "cycles" }), true);
      assert.equal(cites({ entry: "Drop recycles from the gate.", subject: "cycles" }), false);
      assert.equal(cites({ entry: "See langwatch/x-y.", subject: "langwatch/x" }), false);
    });
  });

  void describe("when a decision's rule is a baseline or the loosened config", () => {
    /** @scenario "A decision's rule is neither a baseline nor the config the change loosens" */
    void it("fails a baseline named as the rule", () => {
      const baseline = "packages/architecture-enforcer/tests/baselines/raw-colour.json";
      const decisions = [
        decision("`langwatch/x`, `langwatch/complexity`", baseline),
        decision("dev/docs/ARCHITECTURE.md"),
      ].join("\n");
      const errors = checkDecisions({
        body: body({ decisions }),
        triggers,
        changed: new Set([rule, baseline]),
      });
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /names the baseline/);
    });

    /** @scenario "A decision's rule is neither a baseline nor the config the change loosens" */
    void it("fails the loosened config named as the rule for its own loosening", () => {
      const decisions = [
        decision("`langwatch/x`, `langwatch/complexity`", NATIVE),
        decision("dev/docs/ARCHITECTURE.md"),
      ].join("\n");
      const errors = checkDecisions({
        body: body({ decisions }),
        triggers,
        changed: new Set([rule, NATIVE]),
      });
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /that is the file it loosens/);
    });
  });
});
