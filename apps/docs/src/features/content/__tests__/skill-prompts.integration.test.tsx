import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocsCodeBlock } from "../../code/ui/code-block.tsx";
import { extractSkillPrompts, promptFileName } from "../compile/skill-prompts.ts";
import { SkillCard } from "../ui/skill-card.tsx";

const PROMPT = [
  "# Instrument my code",
  "",
  "Use \"quotes\", 'apostrophes', <tags> & &amp; literally, `ticks`, émoji 🚀 and \\ slashes.",
  "Trailing spaces stay   ",
  "\ttabs stay",
  "",
].join("\n");

function render({ element }: { element: React.ReactElement }) {
  return renderToStaticMarkup(<DesignSystemTestProvider>{element}</DesignSystemTestProvider>);
}

function skillPage() {
  return render({
    element: (
      <SkillCard
        title="Instrument"
        install="npx skills add langwatch/skills/tracing"
        command="/tracing"
        prompt={PROMPT}
      >
        <p>Preview</p>
      </SkillCard>
    ),
  });
}

describe("when the build publishes a page with skill cards", () => {
  /** @scenario "Fetch a skill's full prompt from its own file instead of carrying it in the page" */
  it("moves each prompt into a file holding exactly the text the button copied", () => {
    const pages = new Map([["skills/directory/index.html", skillPage()]]);
    const files = extractSkillPrompts({ pages });
    const name = promptFileName({ prompt: PROMPT });
    expect([...files.keys()]).toEqual([name]);
    expect(Buffer.from(files.get(name) ?? "").equals(Buffer.from(PROMPT))).toBe(true);
    const page = pages.get("skills/directory/index.html") ?? "";
    expect(page).not.toContain("data-docs-copy-prompt");
    expect(page).not.toContain("Trailing spaces stay");
    expect(page).toContain(`data-docs-copy-file="${name}"`);
    expect(page).toContain('data-docs-copy="npx skills add langwatch/skills/tracing"');
  });

  /** @scenario "Fetch a skill's full prompt from its own file instead of carrying it in the page" */
  it("writes a prompt shared by two pages once", () => {
    const pages = new Map([
      ["a/index.html", skillPage()],
      ["b/index.html", skillPage()],
    ]);
    expect(extractSkillPrompts({ pages }).size).toBe(1);
  });

  describe("when a page is served without that step", () => {
    /** @scenario "Fetch a skill's full prompt from its own file instead of carrying it in the page" */
    it("keeps the prompt on the button", () => {
      const page = skillPage();
      expect(page).toContain("data-docs-copy-prompt=");
      expect(page).not.toContain("data-docs-copy-file");
    });
  });
});

describe("when a page renders a code block", () => {
  /** @scenario "Copy a code block from the code it shows" */
  it("keeps the code on the block and none on its copy button", () => {
    const html = render({
      element: (
        <DocsCodeBlock
          data-lang="python"
          data-code={'print("unique-marker")'}
          data-lines={JSON.stringify(['print("unique-marker")'])}
        />
      ),
    });
    expect(html).toContain('data-docs-copy=""');
    expect(html.match(/unique-marker/g)).toHaveLength(2);
    expect(html).toMatch(/data-code="print\(&quot;unique-marker&quot;\)"/);
  });
});
