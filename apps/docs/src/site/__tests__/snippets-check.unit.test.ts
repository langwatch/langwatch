import { describe, expect, it } from "vitest";

import { docsFixture } from "../../testing/docs-fixture.ts";
import { checkSnippets } from "../checks/snippets.ts";

describe("when authored pages import snippets", () => {
  /** @scenario "Imported snippets exist" */
  it("reports imports of missing snippets with the importing file", () => {
    const fixture = docsFixture({
      config: {},
      pages: {
        "snippets/present.mdx": 'import Nested from "/snippets/nested-missing.mdx";\n\nText',
        "guide.mdx":
          'import Present from "/snippets/present.mdx";\nimport { A } from "/snippets/absent.mdx";\n\n<Present />',
        "nested/page.mdx":
          'import Relative from "../snippets/present.mdx";\nimport Gone from "../snippets/gone.mdx";',
        "node_modules/pkg/readme.mdx": 'import X from "/snippets/ignored.mdx";',
      },
    });
    try {
      const { checked, issues } = checkSnippets({ docsRoot: fixture.docsRoot });
      expect(checked).toBe(5);
      expect(issues).toEqual([
        { source: "guide.mdx", href: "/snippets/absent.mdx", code: "missing-snippet" },
        { source: "nested/page.mdx", href: "../snippets/gone.mdx", code: "missing-snippet" },
        {
          source: "snippets/present.mdx",
          href: "/snippets/nested-missing.mdx",
          code: "missing-snippet",
        },
      ]);
    } finally {
      fixture.dispose();
    }
  });
});
