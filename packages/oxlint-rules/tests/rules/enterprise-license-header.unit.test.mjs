import { afterAll, describe, expect, it } from "vitest";

import { enterpriseLicenseHeaderRule } from "../../src/rules/enterprise-license-header.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});
const DIRECTIVE = "// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise";

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(enterpriseLicenseHeaderRule, { code, cwd: workspace.cwd, filename });
}

describe("given a core module source file", () => {
  const filename = "modules/trace/process/src/trace.ts";

  describe("when it opens with the Enterprise SPDX directive", () => {
    /** @scenario "Enterprise-licensed source outside enterprise is reported at the directive line" */
    it("reports enterpriseLicenseOutsideEnterprise on line 1", () => {
      const found = report(`${DIRECTIVE}\nexport {};\n`, filename);

      expect(found).toEqual([
        expect.objectContaining({ messageId: "enterpriseLicenseOutsideEnterprise", line: 1 }),
      ]);
    });
  });

  describe("when the directive sits inside a JSDoc block", () => {
    /** @scenario "A directive inside a block comment is reported at its own line" */
    it("reports the line the directive is on, not the comment's first line", () => {
      const code =
        "/**\n * SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\n */\nexport {};\n";

      expect(report(code, "apps/api/src/enterprise-route.ts")).toEqual([
        expect.objectContaining({ line: 2 }),
      ]);
    });
  });

  describe("when the directive follows an import", () => {
    it.each(["mts", "cts", "js", "mjs"])("reports line 2 in a .%s file", (extension) => {
      const code = `import "./dependency.js";\n${DIRECTIVE}\nexport {};`;

      expect(report(code, `packages/core/src/implementation.${extension}`)).toEqual([
        expect.objectContaining({ line: 2 }),
      ]);
    });
  });

  describe("when the directive follows an interpolated template literal", () => {
    it("reports line 2", () => {
      const code = `const message = \`hello \${name}\`;\n${DIRECTIVE}\nexport {};`;

      expect(report(code, "packages/core/src/implementation.ts")).toEqual([
        expect.objectContaining({ line: 2 }),
      ]);
    });
  });
});

describe("given text that only mentions the marker", () => {
  describe("when the marker is inside a string literal", () => {
    /** @scenario "The marker inside a string is not a directive" */
    it("reports nothing", () => {
      const code = `export const example = "${DIRECTIVE}";`;

      expect(report(code, "packages/core/src/implementation.ts")).toEqual([]);
    });
  });

  describe("when a comment discusses the marker in prose", () => {
    it("reports nothing", () => {
      const code =
        "// This discusses SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\nexport {};\n";

      expect(report(code, "apps/api/src/comment.ts")).toEqual([]);
    });
  });
});

describe("given a file the rule does not govern", () => {
  /** @scenario "Enterprise source, tests, fixtures and declarations are not reported" */
  it.each([
    "enterprise/modules/trace/process/src/trace.ts",
    "apps/api/src/foo.test.ts",
    "apps/api/tests/foo.ts",
    "apps/api/fixtures/foo.ts",
    "apps/api/generated/foo.ts",
    "apps/api/src/foo.d.ts",
    "modules/trace/process/src/__tests__/helper.ts",
  ])("reports nothing for %s", (filename) => {
    expect(report(`${DIRECTIVE}\nexport {};\n`, filename)).toEqual([]);
  });
});
