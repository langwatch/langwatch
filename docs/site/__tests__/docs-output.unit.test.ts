import { describe, expect, it } from "vitest";

import { llmsDirectory, pageTargets } from "../docs-output.mjs";

describe("when configured pages include a section index", () => {
  /** @scenario "Publish index aliases and an LLM directory" */
  it("emits both directory URLs and a Markdown directory from the configured inventory", () => {
    expect(pageTargets({ slug: "governance/index" })).toEqual([
      "governance/index/index.html",
      "governance/index.html",
    ]);
    expect(pageTargets({ slug: "introduction" })).toEqual([
      "index.html",
      "introduction/index.html",
    ]);
    expect(pageTargets({ slug: "integration/quick-start" })).toEqual([
      "integration/quick-start/index.html",
    ]);
    expect(
      llmsDirectory({
        nav: {
          site: { name: "Docs" },
          pages: { "governance/index": { title: "Governance", description: "Control access" } },
        },
      }),
    ).toBe(
      "# Docs\n\n## Documentation\n\n- [Governance](https://docs.langwatch.ai/governance/index.md): Control access\n",
    );
  });
});
