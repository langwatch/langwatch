import { describe, expect, it } from "vitest";

import { llmsDirectory } from "../../features/discovery/compile/discovery-files.ts";
import { extractStyles, pageTargets } from "../document.ts";

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
    const llms = llmsDirectory({
      nav: {
        site: { name: "Docs" },
        pages: { "governance/index": { title: "Governance", description: "Control access" } },
      },
    });
    expect(llms.startsWith("# Docs\n\n> LangWatch is the open-source platform")).toBe(true);
    expect(llms).toContain("https://langwatch.ai/docs/llms-full.txt");
    expect(llms).toContain("npx langwatch report --user-approved");
    expect(llms).toMatch(
      /## Documentation\n\n- \[Governance\]\(https:\/\/langwatch\.ai\/docs\/governance\.md\): Control access\n$/,
    );
  });
});

describe("static style extraction", () => {
  /** @scenario "Extract the exact server styles" */
  it("keeps ordered CSS and readable markup without executing server state", () => {
    const result = extractStyles({
      html: '<style data-emotion="global">:root{--paper:cream}</style><article class="paper">Readable</article><style data-emotion="css">.paper{background:var(--paper)}</style><script>hydrate()</script>',
    });
    expect(result.html).toBe('<article class="paper">Readable</article>');
    expect(result.css).toBe(":root{--paper:cream}\n.paper{background:var(--paper)}");
    expect(extractStyles({ html: "<style>.paper{background:red}</style>" }).href).not.toBe(
      result.href,
    );
  });
});
