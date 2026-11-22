import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocsCodeBlock } from "../../code/ui/code-block.tsx";
import {
  extractPromptBodies,
  extractSkillPrompts,
  promptFileName,
} from "../compile/skill-prompts.ts";
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

function skillPage({ body = <p>Preview</p> }: { body?: React.ReactNode } = {}) {
  return render({
    element: (
      <SkillCard
        title="Instrument"
        install="npx skills add langwatch/skills/tracing"
        command="/tracing"
        prompt={PROMPT}
      >
        {body}
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

const BODY = (
  <>
    <p>Instrument my code</p>
    <p>
      Use the <code>langwatch</code> CLI.
      <br />
      Then follow the steps.
    </p>
    <ul>
      <li>
        <p>unique-third-block</p>
      </li>
    </ul>
    <div>
      <div>unique-nested-block</div>
    </div>
  </>
);

function publishBodies({ pages }: { pages: Map<string, string> }) {
  extractSkillPrompts({ pages });
  return extractPromptBodies({ pages, basePath: "/docs" });
}

describe("when the build publishes a page with skill prompt bodies", () => {
  /** @scenario "Ship a skill prompt's rendered body as its own fragment" */
  it("writes the full rendered body to a content-hashed fragment under the assets", () => {
    const pages = new Map([["skills/directory/index.html", skillPage({ body: BODY })]]);
    const files = publishBodies({ pages });
    const [first] = [...files];
    if (!first) throw new Error("No prompt fragment was published");
    const [name, fragment] = first;
    expect(name).toMatch(/^assets\/skill-prompt-[0-9a-f]{16}\.html$/);
    expect(fragment).toContain("unique-third-block");
    expect(fragment).toContain("unique-nested-block");
    expect(fragment.startsWith("<p")).toBe(true);
    expect(fragment.endsWith("</div>")).toBe(true);
  });

  /** @scenario "Ship a skill prompt's rendered body as its own fragment" */
  it("keeps the first two blocks as a preview and links the prompt's Markdown file", () => {
    const pages = new Map([["skills/directory/index.html", skillPage({ body: BODY })]]);
    const [name] = [...publishBodies({ pages }).keys()];
    const page = pages.get("skills/directory/index.html") ?? "";
    expect(page).toContain(`data-docs-prompt-fragment="/docs/${name}"`);
    expect(page).not.toContain("data-docs-prompt-body");
    expect(page).toContain("Instrument my code");
    expect(page).toContain("Then follow the steps.");
    expect(page).not.toContain("unique-third-block");
    expect(page).not.toContain("unique-nested-block");
    expect(page).toContain(
      `<a href="/docs/${promptFileName({ prompt: PROMPT })}">Read the full prompt</a>`,
    );
    expect(page).toMatch(/Read the full prompt<\/a><\/p><\/div><\/details>/);
  });

  /** @scenario "Ship a skill prompt's rendered body as its own fragment" */
  it("writes a body shared by two pages once", () => {
    const pages = new Map([
      ["a/index.html", skillPage({ body: BODY })],
      ["b/index.html", skillPage({ body: BODY })],
    ]);
    expect(publishBodies({ pages }).size).toBe(1);
  });

  describe("when a page is served without that step", () => {
    /** @scenario "Ship a skill prompt's rendered body as its own fragment" */
    it("keeps the full rendered body in the page", () => {
      const page = skillPage({ body: BODY });
      expect(page).toContain("unique-nested-block");
      expect(page).not.toContain("data-docs-prompt-fragment");
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
